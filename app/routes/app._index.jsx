import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  DataTable,
  Divider,
  Box,
  ProgressBar,
  Banner,
  EmptyState,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getStoreAnalytics, generateAIRecommendations } from "../services/analytics.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Ensure store exists
  let store = await prisma.store.findUnique({
    where: { shopDomain: session.shop }
  });

  if (!store) {
    store = await prisma.store.create({
      data: { shopDomain: session.shop }
    });
  }

  // Get store analytics for the dashboard
  const analytics = await getStoreAnalytics(session.shop);

  // Get recent bundles and upsells
  const recentActivity = await getRecentActivity(session.shop);

  return json({
    analytics,
    recentActivity,
    shop: session.shop,
    hasRecommendations: recentActivity.bundles.length > 0 || recentActivity.upsells.length > 0
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "generate_ai_recommendations") {
    try {
      const result = await generateAIRecommendations(session.shop, admin);
      return json({ 
        success: true, 
        message: `Generated ${result.bundlesCreated} bundles and ${result.upsellsCreated} upsells`
      });
    } catch (error) {
      console.error('Error generating recommendations:', error);
      return json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  return json({ success: false });
};

export default function Dashboard() {
  const { analytics, recentActivity, shop, hasRecommendations } = useLoaderData();
  const fetcher = useFetcher();

  const isGenerating = fetcher.formData?.get("action") === "generate_ai_recommendations";
  const generationResult = fetcher.data;

  const generateRecommendations = () => {
    fetcher.submit(
      { action: "generate_ai_recommendations" },
      { method: "post" }
    );
  };

  return (
    <Page>
      <TitleBar title="AOV Booster Dashboard" />

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* AI Recommendation Section */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">AI-Powered Recommendations</Text>
                  <Badge tone={hasRecommendations ? "success" : "info"}>
                    {hasRecommendations ? "Active" : "Get Started"}
                  </Badge>
                </InlineStack>

                {!hasRecommendations && !isGenerating && (
                  <Banner tone="info" title="Generate Your First AI Recommendations">
                    <Text>Let our AI analyze your store data and create personalized bundle and upsell recommendations to boost your AOV.</Text>
                  </Banner>
                )}

                {isGenerating && (
                  <Banner tone="info" title="Generating Recommendations...">
                    <InlineStack gap="200" align="center">
                      <Spinner size="small" />
                      <Text>Analyzing your products and customer behavior...</Text>
                    </InlineStack>
                  </Banner>
                )}

                {generationResult?.success && (
                  <Banner tone="success" title="Recommendations Generated!">
                    <Text>{generationResult.message}</Text>
                  </Banner>
                )}

                {generationResult?.error && (
                  <Banner tone="critical" title="Error Generating Recommendations">
                    <Text>{generationResult.error}</Text>
                  </Banner>
                )}

                <InlineStack gap="200">
                  <Button 
                    variant="primary" 
                    size="large"
                    onClick={generateRecommendations}
                    loading={isGenerating}
                    disabled={isGenerating}
                  >
                    {hasRecommendations ? "Regenerate AI Recommendations" : "Generate AI Recommendations"}
                  </Button>
                  {hasRecommendations && (
                    <>
                      <Button url="/app/bundles">Manage Bundles</Button>
                      <Button url="/app/upsells">Manage Upsells</Button>
                    </>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Store Info */}
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Store Information</Text>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Shop Domain</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{shop}</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Revenue Overview */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Revenue Overview</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Total Revenue (30d)</Text>
                  <Text variant="headingMd" as="p">
                    ${analytics.totalRevenue?.toFixed(2) || '0.00'}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Bundle Revenue</Text>
                  <Text variant="headingMd" as="p" tone="success">
                    ${analytics.bundleRevenue?.toFixed(2) || '0.00'}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Upsell Revenue</Text>
                  <Text variant="headingMd" as="p" tone="success">
                    ${analytics.upsellRevenue?.toFixed(2) || '0.00'}
                  </Text>
                </InlineStack>
                <Box paddingBlockStart="200">
                  <ProgressBar 
                    progress={analytics.totalRevenue > 0 ? ((analytics.bundleRevenue + analytics.upsellRevenue) / analytics.totalRevenue * 100) : 0}
                    size="small"
                  />
                  <Text variant="captionMd" tone="subdued">
                    {analytics.totalRevenue > 0 ? (((analytics.bundleRevenue + analytics.upsellRevenue) / analytics.totalRevenue * 100)).toFixed(1) : '0.0'}% from AI recommendations
                  </Text>
                </Box>
              </BlockStack>
            </Card>

            {/* AOV Metrics */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Average Order Value</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Overall AOV</Text>
                  <Text variant="headingMd" as="p">
                    ${analytics.averageOrderValue?.toFixed(2) || '0.00'}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">With Bundles</Text>
                  <Text variant="headingMd" as="p" tone="success">
                    ${analytics.bundleAOV?.toFixed(2) || '0.00'}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">With Upsells</Text>
                  <Text variant="headingMd" as="p" tone="success">
                    ${analytics.upsellAOV?.toFixed(2) || '0.00'}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="twoThirds">
          <BlockStack gap="400">
            {/* Active Bundles */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Active Bundles</Text>
                  <Button url="/app/bundles">View All</Button>
                </InlineStack>
                {recentActivity.bundles.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                    headings={['Bundle', 'Type', 'Conversions', 'Revenue']}
                    rows={recentActivity.bundles.map(bundle => [
                      bundle.name,
                      bundle.isAiGenerated ? 'AI Generated' : 'Manual',
                      bundle.conversions,
                      `$${bundle.revenue.toFixed(2)}`
                    ])}
                  />
                ) : (
                  <EmptyState
                    heading="No bundles yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <Text>Generate AI recommendations to create your first product bundles.</Text>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>

            {/* Active Upsells */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Active Upsells</Text>
                  <Button url="/app/upsells">View All</Button>
                </InlineStack>
                {recentActivity.upsells.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                    headings={['Upsell', 'Trigger', 'Conversions', 'Revenue']}
                    rows={recentActivity.upsells.map(upsell => [
                      upsell.name,
                      upsell.triggerType,
                      upsell.conversions,
                      `$${upsell.revenue.toFixed(2)}`
                    ])}
                  />
                ) : (
                  <EmptyState
                    heading="No upsells yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <Text>Generate AI recommendations to create your first upsell offers.</Text>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

async function getRecentActivity(shopDomain) {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
      include: {
        bundles: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 5
        },
        upsells: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });

    if (!store) {
      return { bundles: [], upsells: [] };
    }

    return {
      bundles: store.bundles,
      upsells: store.upsells
    };
  } catch (error) {
    console.error('Error getting recent activity:', error);
    return { bundles: [], upsells: [] };
  }
}