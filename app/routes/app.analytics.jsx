
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Select,
  DataTable,
  ProgressBar,
  Box
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    include: {
      analytics: {
        orderBy: { date: 'desc' },
        take: 30
      },
      bundles: {
        where: { isActive: true },
        orderBy: { revenue: 'desc' },
        take: 10
      },
      upsells: {
        where: { isActive: true },
        orderBy: { revenue: 'desc' },
        take: 10
      }
    }
  });

  return json({
    analytics: store?.analytics || [],
    topBundles: store?.bundles || [],
    topUpsells: store?.upsells || [],
    shop: session.shop
  });
};

export default function Analytics() {
  const { analytics, topBundles, topUpsells } = useLoaderData();
  const [timeframe, setTimeframe] = useState('30');

  const timeframeOptions = [
    { label: 'Last 7 days', value: '7' },
    { label: 'Last 30 days', value: '30' },
    { label: 'Last 90 days', value: '90' }
  ];

  // Calculate totals from analytics data
  const totals = analytics.reduce((acc, day) => ({
    totalRevenue: acc.totalRevenue + day.totalRevenue,
    bundleRevenue: acc.bundleRevenue + day.bundleRevenue,
    upsellRevenue: acc.upsellRevenue + day.upsellRevenue,
    totalOrders: acc.totalOrders + day.totalOrders,
    ordersWithBundles: acc.ordersWithBundles + day.ordersWithBundles,
    ordersWithUpsells: acc.ordersWithUpsells + day.ordersWithUpsells
  }), {
    totalRevenue: 0,
    bundleRevenue: 0,
    upsellRevenue: 0,
    totalOrders: 0,
    ordersWithBundles: 0,
    ordersWithUpsells: 0
  });

  const conversionRates = {
    bundle: totals.totalOrders > 0 ? (totals.ordersWithBundles / totals.totalOrders * 100).toFixed(1) : 0,
    upsell: totals.totalOrders > 0 ? (totals.ordersWithUpsells / totals.totalOrders * 100).toFixed(1) : 0
  };

  const bundleRows = topBundles.map(bundle => [
    bundle.name,
    bundle.impressions,
    bundle.conversions,
    bundle.conversions > 0 ? ((bundle.conversions / bundle.impressions) * 100).toFixed(1) + '%' : '0%',
    `$${bundle.revenue.toFixed(2)}`
  ]);

  const upsellRows = topUpsells.map(upsell => [
    upsell.name,
    upsell.triggerType,
    upsell.impressions,
    upsell.conversions,
    upsell.conversions > 0 ? ((upsell.conversions / upsell.impressions) * 100).toFixed(1) + '%' : '0%',
    `$${upsell.revenue.toFixed(2)}`
  ]);

  return (
    <Page>
      <TitleBar title="Analytics & Performance" />
      
      <Layout>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Timeframe</Text>
                  <Select
                    options={timeframeOptions}
                    value={timeframe}
                    onChange={setTimeframe}
                  />
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Revenue Impact</Text>
                <Box>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Total Revenue</Text>
                    <Text variant="headingMd">${totals.totalRevenue.toFixed(2)}</Text>
                  </InlineStack>
                  <Box paddingBlockStart="200">
                    <ProgressBar progress={100} size="small" />
                  </Box>
                </Box>
                
                <Box>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Bundle Revenue</Text>
                    <Text variant="headingMd" tone="success">${totals.bundleRevenue.toFixed(2)}</Text>
                  </InlineStack>
                  <Box paddingBlockStart="200">
                    <ProgressBar 
                      progress={totals.totalRevenue > 0 ? (totals.bundleRevenue / totals.totalRevenue * 100) : 0} 
                      size="small" 
                    />
                    <Text variant="captionMd" tone="subdued">
                      {totals.totalRevenue > 0 ? ((totals.bundleRevenue / totals.totalRevenue) * 100).toFixed(1) : 0}% of total revenue
                    </Text>
                  </Box>
                </Box>

                <Box>
                  <InlineStack align="space-between">
                    <Text variant="bodyMd">Upsell Revenue</Text>
                    <Text variant="headingMd" tone="success">${totals.upsellRevenue.toFixed(2)}</Text>
                  </InlineStack>
                  <Box paddingBlockStart="200">
                    <ProgressBar 
                      progress={totals.totalRevenue > 0 ? (totals.upsellRevenue / totals.totalRevenue * 100) : 0} 
                      size="small" 
                    />
                    <Text variant="captionMd" tone="subdued">
                      {totals.totalRevenue > 0 ? ((totals.upsellRevenue / totals.totalRevenue) * 100).toFixed(1) : 0}% of total revenue
                    </Text>
                  </Box>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Conversion Rates</Text>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Bundle Conversion</Text>
                  <Text variant="headingMd">{conversionRates.bundle}%</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Upsell Conversion</Text>
                  <Text variant="headingMd">{conversionRates.upsell}%</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="twoThirds">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Top Performing Bundles</Text>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'numeric', 'text', 'numeric']}
                  headings={['Bundle Name', 'Impressions', 'Conversions', 'Conversion Rate', 'Revenue']}
                  rows={bundleRows}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Top Performing Upsells</Text>
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text', 'numeric']}
                  headings={['Upsell Name', 'Trigger Type', 'Impressions', 'Conversions', 'Conversion Rate', 'Revenue']}
                  rows={upsellRows}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
