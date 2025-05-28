
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
  Modal,
  TextField,
  Select,
  FormLayout,
  Toast,
  Frame
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    include: {
      bundles: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  return json({
    bundles: store?.bundles || [],
    shop: session.shop
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");
  
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop }
  });

  if (!store) {
    return json({ success: false, error: "Store not found" });
  }

  if (action === "toggle_bundle") {
    const bundleId = formData.get("bundleId");
    const isActive = formData.get("isActive") === "true";
    
    await prisma.bundle.update({
      where: { id: bundleId },
      data: { isActive }
    });
    
    return json({ success: true });
  }

  if (action === "delete_bundle") {
    const bundleId = formData.get("bundleId");
    
    await prisma.bundle.delete({
      where: { id: bundleId }
    });
    
    return json({ success: true });
  }

  return json({ success: false });
};

export default function Bundles() {
  const { bundles } = useLoaderData();
  const fetcher = useFetcher();
  const [activeModal, setActiveModal] = useState(null);
  const [toastActive, setToastActive] = useState(false);

  const toggleBundle = useCallback((bundleId, currentState) => {
    fetcher.submit(
      { 
        action: "toggle_bundle", 
        bundleId, 
        isActive: (!currentState).toString() 
      },
      { method: "post" }
    );
    setToastActive(true);
  }, [fetcher]);

  const deleteBundle = useCallback((bundleId) => {
    fetcher.submit(
      { action: "delete_bundle", bundleId },
      { method: "post" }
    );
    setActiveModal(null);
    setToastActive(true);
  }, [fetcher]);

  const bundleRows = bundles.map(bundle => [
    bundle.name,
    bundle.isAiGenerated ? <Badge tone="info">AI Generated</Badge> : <Badge>Manual</Badge>,
    `${bundle.discount}%`,
    bundle.conversions,
    `$${bundle.revenue.toFixed(2)}`,
    bundle.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="critical">Inactive</Badge>,
    <InlineStack gap="200">
      <Button
        size="micro"
        onClick={() => toggleBundle(bundle.id, bundle.isActive)}
      >
        {bundle.isActive ? 'Deactivate' : 'Activate'}
      </Button>
      <Button
        size="micro"
        tone="critical"
        onClick={() => setActiveModal(bundle.id)}
      >
        Delete
      </Button>
    </InlineStack>
  ]);

  const toastMarkup = toastActive ? (
    <Toast content="Bundle updated successfully" onDismiss={() => setToastActive(false)} />
  ) : null;

  return (
    <Frame>
      <Page>
        <TitleBar title="Smart Bundles">
          <Button variant="primary" url="/app/bundles/new">
            Create Bundle
          </Button>
        </TitleBar>
        
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">All Bundles</Text>
                  <Text variant="bodyMd" tone="subdued">
                    {bundles.filter(b => b.isActive).length} active bundles
                  </Text>
                </InlineStack>
                
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'text', 'text']}
                  headings={['Name', 'Type', 'Discount', 'Conversions', 'Revenue', 'Status', 'Actions']}
                  rows={bundleRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {activeModal && (
          <Modal
            open={Boolean(activeModal)}
            onClose={() => setActiveModal(null)}
            title="Delete Bundle"
            primaryAction={{
              content: "Delete",
              destructive: true,
              onAction: () => deleteBundle(activeModal)
            }}
            secondaryActions={[{
              content: "Cancel",
              onAction: () => setActiveModal(null)
            }]}
          >
            <Modal.Section>
              <Text>Are you sure you want to delete this bundle? This action cannot be undone.</Text>
            </Modal.Section>
          </Modal>
        )}

        {toastMarkup}
      </Page>
    </Frame>
  );
}
