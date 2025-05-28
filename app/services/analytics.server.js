
import prisma from "../db.server";

export async function getStoreAnalytics(shopDomain) {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
      include: {
        analytics: {
          orderBy: { date: 'desc' },
          take: 30
        }
      }
    });

    if (!store || !store.analytics.length) {
      return {
        totalRevenue: 0,
        bundleRevenue: 0,
        upsellRevenue: 0,
        averageOrderValue: 0,
        bundleAOV: 0,
        upsellAOV: 0
      };
    }

    const latest = store.analytics[0];
    return {
      totalRevenue: latest.totalRevenue,
      bundleRevenue: latest.bundleRevenue,
      upsellRevenue: latest.upsellRevenue,
      averageOrderValue: latest.averageOrderValue,
      bundleAOV: latest.bundleAOV,
      upsellAOV: latest.upsellAOV
    };
  } catch (error) {
    console.error('Error getting store analytics:', error);
    return {
      totalRevenue: 0,
      bundleRevenue: 0,
      upsellRevenue: 0,
      averageOrderValue: 0,
      bundleAOV: 0,
      upsellAOV: 0
    };
  }
}

export async function generateAIRecommendations(shopDomain, admin) {
  try {
    // Get store from database
    let store = await prisma.store.findUnique({
      where: { shopDomain }
    });

    if (!store) {
      store = await prisma.store.create({
        data: { shopDomain }
      });
    }

    // Fetch products from Shopify
    const productsResponse = await admin.graphql(`
      query getProducts($first: Int!) {
        products(first: $first) {
          edges {
            node {
              id
              title
              handle
              productType
              vendor
              tags
              variants(first: 10) {
                edges {
                  node {
                    id
                    price
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: { first: 100 }
    });

    const productsData = await productsResponse.json();
    const products = productsData.data.products.edges.map(edge => edge.node);

    // Fetch orders for analysis
    const ordersResponse = await admin.graphql(`
      query getOrders($first: Int!) {
        orders(first: $first) {
          edges {
            node {
              id
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              lineItems(first: 10) {
                edges {
                  node {
                    id
                    quantity
                    variant {
                      id
                      product {
                        id
                        title
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: { first: 250 }
    });

    const ordersData = await ordersResponse.json();
    const orders = ordersData.data.orders.edges.map(edge => edge.node);

    // Generate AI-powered bundle recommendations
    const bundleRecommendations = await generateBundleRecommendations(products, orders);
    
    // Generate AI-powered upsell recommendations
    const upsellRecommendations = await generateUpsellRecommendations(products, orders);

    // Save recommendations to database
    await saveBundleRecommendations(store.id, bundleRecommendations);
    await saveUpsellRecommendations(store.id, upsellRecommendations);

    return {
      bundlesCreated: bundleRecommendations.length,
      upsellsCreated: upsellRecommendations.length
    };
  } catch (error) {
    console.error('Error generating AI recommendations:', error);
    throw error;
  }
}

async function generateBundleRecommendations(products, orders) {
  // AI logic to analyze product affinity and create bundles
  const productPairs = new Map();
  
  // Analyze orders to find products frequently bought together
  orders.forEach(order => {
    const productIds = order.lineItems.edges.map(edge => edge.node.variant.product.id);
    
    // Create pairs of products bought together
    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const pair = [productIds[i], productIds[j]].sort().join('|');
        productPairs.set(pair, (productPairs.get(pair) || 0) + 1);
      }
    }
  });

  // Find top product pairs and create bundle recommendations
  const topPairs = Array.from(productPairs.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const bundleRecommendations = [];
  
  topPairs.forEach(([pair, frequency]) => {
    const [productId1, productId2] = pair.split('|');
    const product1 = products.find(p => p.id === productId1);
    const product2 = products.find(p => p.id === productId2);
    
    if (product1 && product2 && frequency >= 2) {
      bundleRecommendations.push({
        name: `${product1.title} + ${product2.title} Bundle`,
        description: `AI-recommended bundle based on purchase patterns`,
        mainProductId: productId1.replace('gid://shopify/Product/', ''),
        bundledProducts: [
          { id: productId1.replace('gid://shopify/Product/', ''), quantity: 1 },
          { id: productId2.replace('gid://shopify/Product/', ''), quantity: 1 }
        ],
        discount: 10, // 10% bundle discount
        priority: frequency,
        isAiGenerated: true
      });
    }
  });

  return bundleRecommendations;
}

async function generateUpsellRecommendations(products, orders) {
  // AI logic to find upsell opportunities
  const upsellRecommendations = [];
  
  // Analyze product categories and price points for upsells
  const productsByType = products.reduce((acc, product) => {
    const type = product.productType || 'General';
    if (!acc[type]) acc[type] = [];
    acc[type].push(product);
    return acc;
  }, {});

  // Create upsells within product categories
  Object.entries(productsByType).forEach(([type, typeProducts]) => {
    if (typeProducts.length < 2) return;
    
    // Sort by price to create upgrade upsells
    const sortedProducts = typeProducts.sort((a, b) => {
      const priceA = parseFloat(a.variants.edges[0]?.node.price || 0);
      const priceB = parseFloat(b.variants.edges[0]?.node.price || 0);
      return priceA - priceB;
    });

    // Create upsells from lower to higher priced items
    for (let i = 0; i < sortedProducts.length - 1; i++) {
      const triggerProduct = sortedProducts[i];
      const upsellProduct = sortedProducts[i + 1];
      
      const triggerPrice = parseFloat(triggerProduct.variants.edges[0]?.node.price || 0);
      const upsellPrice = parseFloat(upsellProduct.variants.edges[0]?.node.price || 0);
      
      // Only create upsell if price difference is reasonable (20-200%)
      const priceDifference = (upsellPrice - triggerPrice) / triggerPrice;
      if (priceDifference >= 0.2 && priceDifference <= 2.0) {
        upsellRecommendations.push({
          name: `Upgrade to ${upsellProduct.title}`,
          triggerProductId: triggerProduct.id.replace('gid://shopify/Product/', ''),
          upsellProductId: upsellProduct.id.replace('gid://shopify/Product/', ''),
          triggerType: 'cart',
          discount: 5, // 5% upgrade discount
          priority: Math.floor(priceDifference * 100),
          isAiGenerated: true
        });
      }
    }
  });

  return upsellRecommendations.slice(0, 20); // Limit to top 20 recommendations
}

async function saveBundleRecommendations(storeId, recommendations) {
  for (const recommendation of recommendations) {
    await prisma.bundle.create({
      data: {
        storeId,
        name: recommendation.name,
        description: recommendation.description,
        mainProductId: recommendation.mainProductId,
        bundledProducts: recommendation.bundledProducts,
        discount: recommendation.discount,
        priority: recommendation.priority,
        isAiGenerated: recommendation.isAiGenerated
      }
    });
  }
}

async function saveUpsellRecommendations(storeId, recommendations) {
  for (const recommendation of recommendations) {
    await prisma.upsell.create({
      data: {
        storeId,
        name: recommendation.name,
        triggerProductId: recommendation.triggerProductId,
        upsellProductId: recommendation.upsellProductId,
        triggerType: recommendation.triggerType,
        discount: recommendation.discount,
        priority: recommendation.priority,
        isAiGenerated: recommendation.isAiGenerated
      }
    });
  }
}

export async function updateAnalytics(shopDomain, analyticsData) {
  const store = await prisma.store.findUnique({
    where: { shopDomain }
  });

  if (!store) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.analytics.upsert({
    where: {
      storeId_date: {
        storeId: store.id,
        date: today
      }
    },
    update: analyticsData,
    create: {
      storeId: store.id,
      date: today,
      ...analyticsData
    }
  });
}
