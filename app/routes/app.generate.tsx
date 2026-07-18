import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { generateProductDescription } from "../services/gemini.server";
import { incrementUsage, getMonthlyUsage, logGenerationEvent, updateGenerationStatus } from "../services/usage.server";
import { useAppBridge, TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const usage = await getMonthlyUsage(session.shop);
  return { shop: session.shop, usage };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "generate") {
    const productId = formData.get("productId") as string;
    const tone = formData.get("tone") as string;
    const length = formData.get("length") as string;
    const keywords = formData.get("keywords") as string;

    // Check usage limit before generation
    await incrementUsage(session.shop);

    // Fetch product details
    const response = await admin.graphql(
      `#graphql
      query getProduct($id: ID!) {
        product(id: $id) {
          title
          productType
          vendor
          tags
          descriptionHtml
        }
      }`,
      { variables: { id: productId } }
    );
    const json = await response.json();
    const product = json.data?.product;

    if (!product) throw new Error("Product not found");

    const description = await generateProductDescription(
      {
        title: product.title,
        productType: product.productType,
        vendor: product.vendor,
        tags: product.tags?.join(", "),
        existingDescription: product.descriptionHtml,
      },
      { tone, length, keywords }
    );

    const generation = await logGenerationEvent({
      shopDomain: session.shop,
      productId,
      productTitle: product.title,
      promptSettings: { tone, length, keywords },
      inputText: JSON.stringify(product),
      outputText: description,
      previousDescription: product.descriptionHtml || "",
    });

    return { type: "generated", description, generationId: generation.id };
  }

  if (intent === "apply") {
    const generationId = formData.get("generationId") as string;
    const productId = formData.get("productId") as string;
    const description = formData.get("description") as string;

    const response = await admin.graphql(
      `#graphql
      mutation updateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: productId,
            descriptionHtml: description,
          },
        },
      }
    );

    const result = await response.json();
    if (result.data?.productUpdate?.userErrors?.length > 0) {
      return { type: "error", errors: result.data.productUpdate.userErrors };
    }

    await updateGenerationStatus(generationId, "applied");
    return { type: "applied" };
  }

  return null;
};

export default function Generate() {
  const { usage } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [tone, setTone] = useState("Professional");
  const [length, setLength] = useState("Medium");
  const [keywords, setKeywords] = useState("");
  const [editedDescription, setEditedDescription] = useState("");

  const handleSelectProduct = async () => {
    const selection = await shopify.resourcePicker({ type: "product", multiple: false });
    if (selection && selection.length > 0) {
      setSelectedProduct(selection[0]);
    }
  };

  const isGenerating = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "generate";
  const isApplying = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "apply";

  const generatedData = fetcher.data?.type === "generated" ? fetcher.data : null;
  const appliedData = fetcher.data?.type === "applied" ? fetcher.data : null;

  // Sync edited description with generated output
  if (generatedData && !editedDescription && !isGenerating) {
    setEditedDescription(generatedData.description || "");
  }

  if (appliedData) {
    shopify.toast.show("Description applied to product successfully!");
  }

  return (
    <s-page heading="Generate Product Description">
      <TitleBar title="Generate" />
      
      <s-section heading="1. Select a Product">
        <s-stack direction="block" gap="base">
              
              {selectedProduct ? (
                <s-box padding="base" background="subdued" borderRadius="base">
                  <strong>{selectedProduct.title}</strong>
                  <br/>
                  <s-button variant="tertiary" onClick={handleSelectProduct}>Change Product</s-button>
                </s-box>
              ) : (
                <s-button onClick={handleSelectProduct}>Select Product</s-button>
              )}

              <s-heading>2. AI Settings</s-heading>
              
              <fetcher.Form method="POST">
                <input type="hidden" name="intent" value="generate" />
                <input type="hidden" name="productId" value={selectedProduct?.id || ""} />
                
                <s-stack direction="block" gap="base">
                  <s-text>Tone</s-text>
                  <select name="tone" value={tone} onChange={(e) => setTone(e.target.value)} style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%'}}>
                    <option value="Professional">Professional</option>
                    <option value="Playful">Playful</option>
                    <option value="Luxury">Luxury</option>
                    <option value="Minimal">Minimal</option>
                    <option value="Persuasive">Persuasive</option>
                  </select>

                  <s-text>Length</s-text>
                  <select name="length" value={length} onChange={(e) => setLength(e.target.value)} style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%'}}>
                    <option value="Short">Short (1-2 sentences)</option>
                    <option value="Medium">Medium (1 paragraph)</option>
                    <option value="Long">Long (Detailed with bullets)</option>
                  </select>

                  <s-text>Keywords (optional)</s-text>
                  <input type="text" name="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. eco-friendly, waterproof" style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%'}} />

                  <button type="submit" disabled={!selectedProduct || isGenerating || usage.generationsUsed >= usage.generationsLimit} style={{padding: '8px 16px', background: '#000', color: '#fff', borderRadius: '4px', cursor: 'pointer'}}>
                    {isGenerating ? "Generating..." : "Generate Description"}
                  </button>
                </s-stack>
              </fetcher.Form>
        </s-stack>
      </s-section>

        {generatedData && (
          <s-section heading="Generated Result">
            <s-stack direction="block" gap="base">
                <textarea 
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  style={{width: '100%', height: '200px', padding: '8px', borderRadius: '4px', border: '1px solid #ccc'}}
                />
                
                <fetcher.Form method="POST">
                  <input type="hidden" name="intent" value="apply" />
                  <input type="hidden" name="productId" value={selectedProduct?.id} />
                  <input type="hidden" name="generationId" value={generatedData.generationId} />
                  <input type="hidden" name="description" value={editedDescription} />
                  
                  <button type="submit" disabled={isApplying} style={{padding: '8px 16px', background: '#000', color: '#fff', borderRadius: '4px', cursor: 'pointer'}}>
                    {isApplying ? "Applying..." : "Apply to Product"}
                  </button>
                </fetcher.Form>
            </s-stack>
          </s-section>
        )}
    </s-page>
  );
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
