import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { getMonthlyUsage } from "../services/usage.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { TitleBar } from "@shopify/app-bridge-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const usage = await getMonthlyUsage(session.shop);

  return {
    shop: session.shop,
    usage,
  };
};

export default function Index() {
  const { usage } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const progress = usage.generationsLimit > 0 ? (usage.generationsUsed / usage.generationsLimit) * 100 : 0;
  const isLimitReached = usage.generationsUsed >= usage.generationsLimit;

  return (
    <s-page heading="AI Description Generator">
      <TitleBar title="Dashboard" />

      <s-section heading="Welcome to AI Product Description Generator">
        <s-paragraph>
          Generate high-quality, SEO-friendly product descriptions for your catalog in seconds.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" onClick={() => navigate("/app/generate")}>
            Generate for a Product
          </s-button>
          <s-button onClick={() => navigate("/app/history")}>
            View History
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Monthly Usage">
        <s-paragraph>
          {usage.generationsUsed} of {usage.generationsLimit} descriptions generated this month.
        </s-paragraph>
        
        {isLimitReached ? (
          <s-box background="subdued" padding="base" borderRadius="base">
            <span style={{ color: 'red', fontWeight: 'bold' }}>
              You have reached your monthly generation limit. Please upgrade your plan.
            </span>
          </s-box>
        ) : (
          <s-box background="subdued" padding="base" borderRadius="base">
            <s-text>
              You have {usage.generationsLimit - usage.generationsUsed} generations remaining for this billing cycle.
            </s-text>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
