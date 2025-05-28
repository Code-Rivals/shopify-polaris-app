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
  Icon,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getStoreAnalytics, generateAIRecommendations } from "../services/analytics.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Get store analytics for the dashboard
  const analytics = await getStoreAnalytics(session.shop);

  // Get recent bundles and upsells
  const recentActivity = await getRecentActivity(session.shop);

  return json({
    analytics,
    recentActivity,
    shop: session.shop
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "generate_ai_recommendations") {
    await generateAIRecommendations(session.shop, admin);
    return json({ success: true });
  }

  return json({ success: false });
};

export default function Dashboard() {
  const { analytics, recentActivity } = useLoaderData();
  const fetcher = useFetcher();

  const isGenerating = fetcher.formData?.get("action") === "generate_ai_recommendations";

  const generateRecommendations = () => {
    fetcher.submit(
      { action: "generate_ai_recommendations" },
      { method: "post" }
    );
  };

  return (
    <Page>
      <TitleBar title="AOV Booster Dashboard">
        <Button 
          variant="primary" 
          onClick={generateRecommendations}
          loading={isGenerating}
        >
          Generate AI Recommendations
        </Button>
      </TitleBar>

      <Layout>
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
                    progress={((analytics.bundleRevenue + analytics.upsellRevenue) / analytics.totalRevenue * 100) || 0}
                    size="small"
                  />
                  <Text variant="captionMd" tone="subdued">
                    {(((analytics.bundleRevenue + analytics.upsellRevenue) / analytics.totalRevenue * 100) || 0).toFixed(1)}% from AI recommendations
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
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                  headings={['Bundle', 'Type', 'Conversions', 'Revenue']}
                  rows={recentActivity.bundles?.map(bundle => [
                    bundle.name,
                    bundle.isAiGenerated ? 'AI Generated' : 'Manual',
                    bundle.conversions,
                    `$${bundle.revenue.toFixed(2)}`
                  ]) || []}
                />
              </BlockStack>
            </Card>

            {/* Active Upsells */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Active Upsells</Text>
                  <Button url="/app/upsells">View All</Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                  headings={['Upsell', 'Trigger', 'Conversions', 'Revenue']}
                  rows={recentActivity.upsells?.map(upsell => [
                    upsell.name,
                    upsell.triggerType,
                    upsell.conversions,
                    `$${upsell.revenue.toFixed(2)}`
                  ]) || []}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

async function getRecentActivity(shop) {
  // This would typically query your database
  // For now, returning mock data structure
  return {
    bundles: [],
    upsells: []
  };
}