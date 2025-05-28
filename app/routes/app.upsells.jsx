
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
      upsells: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  return json({
    upsells: store?.upsells || [],
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

  if (action === "toggle_upsell") {
    const upsellId = formData.get("upsellId");
    const isActive = formData.get("isActive") === "true";
    
    await prisma.upsell.update({
      where: { id: upsellId },
      data: { isActive }
    });
    
    return json({ success: true });
  }

  if (action === "delete_upsell") {
    const upsellId = formData.get("upsellId");
    
    await prisma.upsell.delete({
      where: { id: upsellId }
    });
    
    return json({ success: true });
  }

  return json({ success: false });
};

export default function Upsells() {
  const { upsells } = useLoaderData();
  const fetcher = useFetcher();
  const [activeModal, setActiveModal] = useState(null);
  const [toastActive, setToastActive] = useState(false);

  const toggleUpsell = useCallback((upsellId, currentState) => {
    fetcher.submit(
      { 
        action: "toggle_upsell", 
        upsellId, 
        isActive: (!currentState).toString() 
      },
      { method: "post" }
    );
    setToastActive(true);
  }, [fetcher]);

  const deleteUpsell = useCallback((upsellId) => {
    fetcher.submit(
      { action: "delete_upsell", upsellId },
      { method: "post" }
    );
    setActiveModal(null);
    setToastActive(true);
  }, [fetcher]);

  const getTriggerTypeBadge = (triggerType) => {
    const types = {
      'cart': { tone: 'info', label: 'In Cart' },
      'post_purchase': { tone: 'success', label: 'Post Purchase' },
      'product_page': { tone: 'warning', label: 'Product Page' }
    };
    
    const type = types[triggerType] || { tone: 'subdued', label: triggerType };
    return <Badge tone={type.tone}>{type.label}</Badge>;
  };

  const upsellRows = upsells.map(upsell => [
    upsell.name,
    upsell.isAiGenerated ? <Badge tone="info">AI Generated</Badge> : <Badge>Manual</Badge>,
    getTriggerTypeBadge(upsell.triggerType),
    `${upsell.discount}%`,
    upsell.conversions,
    `$${upsell.revenue.toFixed(2)}`,
    upsell.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="critical">Inactive</Badge>,
    <InlineStack gap="200">
      <Button
        size="micro"
        onClick={() => toggleUpsell(upsell.id, upsell.isActive)}
      >
        {upsell.isActive ? 'Deactivate' : 'Activate'}
      </Button>
      <Button
        size="micro"
        tone="critical"
        onClick={() => setActiveModal(upsell.id)}
      >
        Delete
      </Button>
    </InlineStack>
  ]);

  const toastMarkup = toastActive ? (
    <Toast content="Upsell updated successfully" onDismiss={() => setToastActive(false)} />
  ) : null;

  return (
    <Frame>
      <Page>
        <TitleBar title="Smart Upsells">
          <Button variant="primary" url="/app/upsells/new">
            Create Upsell
          </Button>
        </TitleBar>
        
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">All Upsells</Text>
                  <Text variant="bodyMd" tone="subdued">
                    {upsells.filter(u => u.isActive).length} active upsells
                  </Text>
                </InlineStack>
                
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'numeric', 'text', 'text']}
                  headings={['Name', 'Type', 'Trigger', 'Discount', 'Conversions', 'Revenue', 'Status', 'Actions']}
                  rows={upsellRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {activeModal && (
          <Modal
            open={Boolean(activeModal)}
            onClose={() => setActiveModal(null)}
            title="Delete Upsell"
            primaryAction={{
              content: "Delete",
              destructive: true,
              onAction: () => deleteUpsell(activeModal)
            }}
            secondaryActions={[{
              content: "Cancel",
              onAction: () => setActiveModal(null)
            }]}
          >
            <Modal.Section>
              <Text>Are you sure you want to delete this upsell? This action cannot be undone.</Text>
            </Modal.Section>
          </Modal>
        )}

        {toastMarkup}
      </Page>
    </Frame>
  );
}
