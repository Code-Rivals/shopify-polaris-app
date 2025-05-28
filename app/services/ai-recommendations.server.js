
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateAIRecommendations(products, shopDomain) {
  if (!products || products.length === 0) {
    return [];
  }

  try {
    // Prepare product data for AI analysis
    const productSummary = products.map(product => ({
      title: product.title,
      type: product.productType,
      vendor: product.vendor,
      tags: product.tags,
      avgPrice: product.variants.nodes.reduce((sum, variant) => sum + parseFloat(variant.price), 0) / product.variants.nodes.length
    }));

    const prompt = `
      Analyze these products from a Shopify store and provide intelligent bundling and upselling recommendations:
      
      Products: ${JSON.stringify(productSummary, null, 2)}
      
      Please provide:
      1. 3-5 smart product bundle recommendations
      2. Upselling opportunities 
      3. Cross-selling suggestions
      4. Pricing strategies
      
      Return the response as a JSON object with this structure:
      {
        "bundles": [
          {
            "name": "Bundle Name",
            "products": ["Product 1", "Product 2"],
            "discount": 15,
            "reason": "Why this bundle works"
          }
        ],
        "upsells": [
          {
            "baseProduct": "Product Name",
            "upsellProduct": "Higher Value Product",
            "reason": "Why to upsell"
          }
        ],
        "crossSells": [
          {
            "triggerProduct": "Product Name", 
            "suggestedProducts": ["Product 1", "Product 2"],
            "reason": "Why these work together"
          }
        ]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are an e-commerce optimization expert. Analyze product data and provide actionable recommendations to increase AOV through smart bundling and upselling."
        },
        {
          role: "user", 
          content: prompt
        }
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const recommendations = JSON.parse(completion.choices[0].message.content);
    
    // Store recommendations in database
    await prisma.aiRecommendation.create({
      data: {
        storeId: shopDomain,
        recommendations: JSON.stringify(recommendations),
        generatedAt: new Date()
      }
    });

    return recommendations;
  } catch (error) {
    console.error('AI Recommendation Error:', error);
    throw error;
  }
}
