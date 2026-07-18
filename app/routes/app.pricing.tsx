import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

const PLAN = "Pro Plan - Monthly";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const billingCheck = await billing.check({
    plans: [PLAN],
    isTest: true,
  });

  const hasActivePayment = billingCheck.hasActivePayment;

  return { hasActivePayment };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    try {
      await billing.require({
        plans: [PLAN],
        isTest: true,
        onFailure: async () => billing.request({ plan: PLAN, isTest: true }),
      });
    } catch (e: any) {
      if (e instanceof Response) throw e;
      if (e.errorData) {
        throw new Error(`Shopify Billing Error: ${JSON.stringify(e.errorData)}`);
      }
      throw e;
    }
    return null;
  }

  if (intent === "cancel") {
    const billingCheck = await billing.check({
      plans: [PLAN],
      isTest: true,
    });
    
    const subscription = billingCheck.appSubscriptions[0];
    if (subscription) {
      await billing.cancel({
        subscriptionId: subscription.id,
        isTest: true,
        prorate: true,
      });
    }
    return { success: true };
  }

  return null;
};

export default function Pricing() {
  const { hasActivePayment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isSubmitting = fetcher.state === "submitting";

  return (
    <s-page heading="Pricing Plans">
      <TitleBar title="Pricing" />

      <s-section heading="Choose the right plan for your business">
        <s-stack direction="block" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <span>
              For this test phase, all features are fully available on the Free plan. 
              You can test the upgrade flow using the Pro plan below (it will use the Shopify Billing API test mode, so you will not be charged).
            </span>
          </s-box>

          <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
            {/* Free Plan */}
            <div style={{ flex: 1, padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
              <h2>Free Plan</h2>
              <p style={{ fontSize: '24px', fontWeight: 'bold' }}>$0 / month</p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>Up to 5000 generations / month</li>
                <li>Single Product generation</li>
                <li>Bulk Generation</li>
                <li>Access to all tones</li>
              </ul>
              
              <div style={{ marginTop: '20px' }}>
                {!hasActivePayment ? (
                  <s-box background="subdued" padding="base" borderRadius="base">
                    <span style={{ color: 'green', fontWeight: 'bold' }}>Current Plan</span>
                  </s-box>
                ) : (
                  <fetcher.Form method="POST">
                    <input type="hidden" name="intent" value="cancel" />
                    <button type="submit" disabled={isSubmitting} style={{padding: '8px 16px', background: '#ccc', borderRadius: '4px', cursor: 'pointer', width: '100%'}}>
                      Downgrade to Free
                    </button>
                  </fetcher.Form>
                )}
              </div>
            </div>

            {/* Pro Plan */}
            <div style={{ flex: 1, padding: '20px', border: '2px solid #000', borderRadius: '8px' }}>
              <h2>Pro Plan</h2>
              <p style={{ fontSize: '24px', fontWeight: 'bold' }}>$29 / month</p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>Unlimited generations</li>
                <li>Priority support</li>
                <li>Advanced SEO metadata (Coming Soon)</li>
              </ul>
              
              <div style={{ marginTop: '20px' }}>
                {hasActivePayment ? (
                  <s-box background="subdued" padding="base" borderRadius="base">
                    <span style={{ color: 'green', fontWeight: 'bold' }}>Current Plan</span>
                  </s-box>
                ) : (
                  <fetcher.Form method="POST">
                    <input type="hidden" name="intent" value="upgrade" />
                    <button type="submit" disabled={isSubmitting} style={{padding: '8px 16px', background: '#000', color: '#fff', borderRadius: '4px', cursor: 'pointer', width: '100%'}}>
                      Upgrade to Pro
                    </button>
                  </fetcher.Form>
                )}
              </div>
            </div>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
