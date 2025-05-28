import prisma from "../db.server";
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  try {
    // Prepare product data for OpenAI analysis
    const productData = products.map(p => ({
      id: p.id.replace('gid://shopify/Product/', ''),
      title: p.title,
      type: p.productType,
      vendor: p.vendor,
      tags: p.tags,
      price: parseFloat(p.variants.edges[0]?.node.price || 0)
    }));

    // Prepare order data for purchase pattern analysis
    const orderPatterns = orders.map(order => ({
      products: order.lineItems.edges.map(edge => ({
        id: edge.node.variant.product.id.replace('gid://shopify/Product/', ''),
        title: edge.node.variant.product.title,
        quantity: edge.node.quantity
      })),
      totalAmount: parseFloat(order.totalPriceSet.shopMoney.amount)
    }));

    const prompt = `
You are an expert e-commerce analyst. Analyze the following store data and create intelligent product bundles that will increase Average Order Value (AOV).

PRODUCTS:
${JSON.stringify(productData, null, 2)}

PURCHASE PATTERNS:
${JSON.stringify(orderPatterns, null, 2)}

Based on this data, create 5-8 strategic product bundles. Consider:
1. Products frequently bought together
2. Complementary items (accessories with main products)
3. Different price points to maximize AOV
4. Seasonal trends and product categories
5. Cross-category opportunities

For each bundle, provide:
- name: Compelling bundle name
- description: Why this bundle makes sense
- products: Array of product IDs to include
- discount: Recommended discount percentage (5-15%)
- reasoning: Brief explanation of the bundle logic

Return valid JSON array format only.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    });

    const aiResponse = completion.choices[0].message.content;
    let bundleRecommendations = [];

    try {
      const parsedBundles = JSON.parse(aiResponse);

      bundleRecommendations = parsedBundles.map((bundle, index) => {
        const mainProductId = bundle.products[0];
        const bundledProducts = bundle.products.map(id => ({ id, quantity: 1 }));

        return {
          name: bundle.name,
          description: bundle.description,
          mainProductId: mainProductId,
          bundledProducts: bundledProducts,
          discount: bundle.discount || 10,
          priority: 100 - index, // Higher priority for first recommendations
          isAiGenerated: true,
          aiReasoning: bundle.reasoning
        };
      });
    } catch (parseError) {
      console.error('Error parsing OpenAI bundle response:', parseError);
      // Fallback to basic analysis if OpenAI fails
      return await generateBasicBundleRecommendations(products, orders);
    }

    return bundleRecommendations;
  } catch (error) {
    console.error('OpenAI API error for bundles:', error);
    // Fallback to basic analysis
    return await generateBasicBundleRecommendations(products, orders);
  }
}

async function generateUpsellRecommendations(products, orders) {
  try {
    // Prepare data for OpenAI analysis
    const productData = products.map(p => ({
      id: p.id.replace('gid://shopify/Product/', ''),
      title: p.title,
      type: p.productType,
      vendor: p.vendor,
      tags: p.tags,
      price: parseFloat(p.variants.edges[0]?.node.price || 0)
    }));

    const customerBehavior = orders.map(order => ({
      products: order.lineItems.edges.map(edge => edge.node.variant.product.title),
      value: parseFloat(order.totalPriceSet.shopMoney.amount)
    }));

    const prompt = `
You are an expert e-commerce conversion specialist. Create strategic upsell recommendations to maximize Average Order Value.

PRODUCTS:
${JSON.stringify(productData, null, 2)}

CUSTOMER BEHAVIOR:
${JSON.stringify(customerBehavior, null, 2)}

Create 8-12 intelligent upsell strategies. Consider:
1. Natural upgrade paths (basic → premium versions)
2. Add-on opportunities (accessories, warranties, services)
3. Cross-sell complementary products
4. Price-point optimization for maximum conversion
5. Customer behavior patterns

For each upsell, provide:
- name: Compelling upsell offer name
- triggerProductId: Product ID that triggers this upsell
- upsellProductId: Product ID being upsold
- triggerType: "cart", "product_page", or "post_purchase"
- discount: Recommended discount (0-10%)
- reasoning: Why this upsell will convert

Return valid JSON array format only.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    });

    const aiResponse = completion.choices[0].message.content;
    let upsellRecommendations = [];

    try {
      const parsedUpsells = JSON.parse(aiResponse);

      upsellRecommendations = parsedUpsells.map((upsell, index) => ({
        name: upsell.name,
        triggerProductId: upsell.triggerProductId,
        upsellProductId: upsell.upsellProductId,
        triggerType: upsell.triggerType || 'cart',
        discount: upsell.discount || 5,
        priority: 100 - index,
        isAiGenerated: true,
        aiReasoning: upsell.reasoning
      }));
    } catch (parseError) {
      console.error('Error parsing OpenAI upsell response:', parseError);
      return await generateBasicUpsellRecommendations(products, orders);
    }

    return upsellRecommendations;
  } catch (error) {
    console.error('OpenAI API error for upsells:', error);
    return await generateBasicUpsellRecommendations(products, orders);
  }
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
// Fallback functions for when OpenAI is unavailable
async function generateBasicBundleRecommendations(products, orders) {
  const productPairs = new Map();

  orders.forEach(order => {
    const productIds = order.lineItems.edges.map(edge => edge.node.variant.product.id);

    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const pair = [productIds[i], productIds[j]].sort().join('|');
        productPairs.set(pair, (productPairs.get(pair) || 0) + 1);
      }
    }
  });

  const topPairs = Array.from(productPairs.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const bundleRecommendations = [];

  topPairs.forEach(([pair, frequency]) => {
    const [productId1, productId2] = pair.split('|');
    const product1 = products.find(p => p.id === productId1);
    const product2 = products.find(p => p.id === productId2);

    if (product1 && product2 && frequency >= 2) {
      bundleRecommendations.push({
        name: `${product1.title} + ${product2.title} Bundle`,
        description: `Frequently bought together`,
        mainProductId: productId1.replace('gid://shopify/Product/', ''),
        bundledProducts: [
          { id: productId1.replace('gid://shopify/Product/', ''), quantity: 1 },
          { id: productId2.replace('gid://shopify/Product/', ''), quantity: 1 }
        ],
        discount: 10,
        priority: frequency,
        isAiGenerated: true
      });
    }
  });

  return bundleRecommendations;
}

async function generateBasicUpsellRecommendations(products, orders) {
  const upsellRecommendations = [];

  const productsByType = products.reduce((acc, product) => {
    const type = product.productType || 'General';
    if (!acc[type]) acc[type] = [];
    acc[type].push(product);
    return acc;
  }, {});

  Object.entries(productsByType).forEach(([type, typeProducts]) => {
    if (typeProducts.length < 2) return;

    const sortedProducts = typeProducts.sort((a, b) => {
      const priceA = parseFloat(a.variants.edges[0]?.node.price || 0);
      const priceB = parseFloat(b.variants.edges[0]?.node.price || 0);
      return priceA - priceB;
    });

    for (let i = 0; i < sortedProducts.length - 1; i++) {
      const triggerProduct = sortedProducts[i];
      const upsellProduct = sortedProducts[i + 1];

      const triggerPrice = parseFloat(triggerProduct.variants.edges[0]?.node.price || 0);
      const upsellPrice = parseFloat(upsellProduct.variants.edges[0]?.node.price || 0);

      const priceDifference = (upsellPrice - triggerPrice) / triggerPrice;
      if (priceDifference >= 0.2 && priceDifference <= 2.0) {
        upsellRecommendations.push({
          name: `Upgrade to ${upsellProduct.title}`,
          triggerProductId: triggerProduct.id.replace('gid://shopify/Product/', ''),
          upsellProductId: upsellProduct.id.replace('gid://shopify/Product/', ''),
          triggerType: 'cart',
          discount: 5,
          priority: Math.floor(priceDifference * 100),
          isAiGenerated: true
        });
      }
    }
  });

  return upsellRecommendations.slice(0, 10);
}

export async function getRecentActivity(shopDomain) {
  // In a real implementation, this would fetch actual activity data
  // For now, return empty array to avoid mock data
  return [];
}

export async function generateAIRecommendations(analytics, shopDomain) {
  // AI recommendations based on actual store analytics
  const recommendations = [];

  // Analyze conversion rate
  if (analytics.conversionRate < 2.0) {
    recommendations.push("Consider optimizing your product pages to improve conversion rate");
    recommendations.push("Add customer reviews and testimonials to build trust");
  }

  // Analyze average order value
  if (analytics.averageOrderValue < 50) {
    recommendations.push("Implement bundle offers to increase average order value");
    recommendations.push("Add upsell suggestions at checkout");
  }

  // Analyze cart abandonment
  if (analytics.cartAbandonmentRate > 70) {
    recommendations.push("Send cart abandonment emails to recover lost sales");
    recommendations.push("Simplify your checkout process to reduce abandonment");
  }

  // General recommendations based on store performance
  if (analytics.totalRevenue < 1000) {
    recommendations.push("Focus on driving more traffic through SEO and social media");
    recommendations.push("Consider running targeted ad campaigns");
  }

  // If performance is good, suggest optimization
  if (analytics.conversionRate > 3.0 && analytics.averageOrderValue > 75) {
    recommendations.push("Your store is performing well! Consider expanding to new markets");
    recommendations.push("Implement loyalty programs to retain customers");
  }

  // Default recommendations if no specific issues found
  if (recommendations.length === 0) {
    recommendations.push("Continue monitoring your analytics for optimization opportunities");
    recommendations.push("Test different product descriptions and images");
    recommendations.push("Consider seasonal promotions to boost sales");
  }

  return recommendations;
}