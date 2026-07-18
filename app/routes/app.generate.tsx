import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { generateProductDescription } from "../services/gemini.server";
import { incrementUsage, getMonthlyUsage, logGenerationEvent, updateGenerationStatus } from "../services/usage.server";
import { useAppBridge, TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const usage = await getMonthlyUsage(session.shop);
  
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";

  let query = "";
  if (cursor) {
    if (direction === "next") {
      query = `query { products(first: 20, after: "${cursor}") { pageInfo { hasNextPage hasPreviousPage endCursor startCursor } edges { cursor node { id title status descriptionHtml } } } }`;
    } else {
      query = `query { products(last: 20, before: "${cursor}") { pageInfo { hasNextPage hasPreviousPage endCursor startCursor } edges { cursor node { id title status descriptionHtml } } } }`;
    }
  } else {
    query = `query { products(first: 20) { pageInfo { hasNextPage hasPreviousPage endCursor startCursor } edges { cursor node { id title status descriptionHtml } } } }`;
  }

  const response = await admin.graphql(query);
  const json = await response.json();
  const productsData = json.data?.products;

  return { shop: session.shop, usage, productsData };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "generate_and_apply") {
    const productId = formData.get("productId") as string;
    const tone = formData.get("tone") as string;
    const length = formData.get("length") as string;
    const keywords = formData.get("keywords") as string;

    try {
      await incrementUsage(session.shop);
    } catch (e: any) {
      return { success: false, error: e.message };
    }

    const response = await admin.graphql(
      `#graphql
      query getProduct($id: ID!) {
        product(id: $id) { title productType vendor tags descriptionHtml }
      }`,
      { variables: { id: productId } }
    );
    const json = await response.json();
    const product = json.data?.product;

    if (!product) return { success: false, error: "Product not found" };

    try {
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

      const updateRes = await admin.graphql(
        `#graphql
        mutation updateProduct($input: ProductInput!) {
          productUpdate(input: $input) { userErrors { message } }
        }`,
        { variables: { input: { id: productId, descriptionHtml: description } } }
      );

      const updateJson = await updateRes.json();
      if (updateJson.data?.productUpdate?.userErrors?.length > 0) {
        return { success: false, error: updateJson.data.productUpdate.userErrors[0].message };
      }

      const generation = await logGenerationEvent({
        shopDomain: session.shop,
        productId,
        productTitle: product.title,
        promptSettings: { tone, length, keywords },
        inputText: JSON.stringify(product),
        outputText: description,
        previousDescription: product.descriptionHtml || "",
      });

      await updateGenerationStatus(generation.id, "applied");

      return { success: true, description };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  return null;
};

function BulkRowGenerator({ product, isSelected, onToggle, shouldGenerate, onComplete, tone, length, keywords }: any) {
  const fetcher = useFetcher();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (shouldGenerate && fetcher.state === "idle" && !fetcher.data && status === null) {
      setStatus("Generating...");
      const formData = new FormData();
      formData.append("intent", "generate_and_apply");
      formData.append("productId", product.id);
      formData.append("tone", tone);
      formData.append("length", length);
      formData.append("keywords", keywords);
      fetcher.submit(formData, { method: "POST" });
    }
  }, [shouldGenerate, fetcher.state, fetcher.data, status, tone, length, keywords, product.id, fetcher]);

  useEffect(() => {
    if (shouldGenerate && fetcher.data && status === "Generating...") {
       const data = fetcher.data as any;
       if (data && data.success) {
         setStatus("Generated!");
       } else {
         setStatus("Error: " + (data?.error || "Unknown"));
       }
       onComplete(product.id);
    }
  }, [fetcher.data, shouldGenerate, status, onComplete, product.id]);

  const hasDescription = !!product.descriptionHtml;
  
  return (
    <tr style={{borderBottom: '1px solid #eee', backgroundColor: isSelected ? '#f0f8ff' : 'transparent'}}>
      <td style={{padding: '12px 8px'}}>
        <input 
          type="checkbox" 
          checked={isSelected}
          onChange={() => onToggle(product.id)}
        />
      </td>
      <td style={{padding: '12px 8px'}}>
        <strong>{product.title}</strong>
        <div style={{ fontSize: '12px', color: '#666' }}>
          {hasDescription ? "Has description" : "No description"}
        </div>
      </td>
      <td style={{padding: '12px 8px'}}>{product.status}</td>
      <td style={{padding: '12px 8px'}}>
        {status && (
          <span style={{ color: status === 'Generated!' ? 'green' : (status === 'Generating...' ? '#666' : 'red'), fontWeight: 'bold' }}>
            {status}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function BulkGenerate() {
  const { usage, productsData } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [tone, setTone] = useState("Professional");
  const [length, setLength] = useState("Medium");
  const [keywords, setKeywords] = useState("");
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<string[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ total: 0, current: 0, active: false });

  const products = productsData?.edges || [];
  const pageInfo = productsData?.pageInfo || {};

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p: any) => p.node.id)));
    }
  };

  const handleBulkGenerate = () => {
    if (selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    setQueue(ids);
    setProgress({ total: ids.length, current: 0, active: true });
    setProcessingId(ids[0]);
  };
  useEffect(() => {
    if (progress.active && queue.length > 0 && processingId !== queue[0]) {
      setProcessingId(queue[0]);
    } else if (progress.active && queue.length === 0) {
      setProcessingId(null);
      setProgress(p => ({ ...p, active: false }));
      shopify.toast.show("Bulk generation complete!");
    }
  }, [queue, progress.active, processingId, shopify]);

  const handleRowComplete = (id: string) => {
    setQueue(prevQueue => {
      const nextQ = prevQueue.filter(qId => qId !== id);
      setProgress(p => ({ ...p, current: p.total - nextQ.length }));
      return nextQ;
    });
  };

  const isLimitReached = usage.generationsUsed >= usage.generationsLimit;

  return (
    <s-page heading="Bulk Generator">
      <TitleBar title="Bulk Generate" />
      
      <s-section heading="AI Settings">
        <s-stack direction="block" gap="base">
          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ flex: 1 }}>
              <s-text>Tone</s-text>
              <select value={tone} onChange={(e) => setTone(e.target.value)} style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', marginTop: '4px'}}>
                <option value="Professional">Professional</option>
                <option value="Playful">Playful</option>
                <option value="Luxury">Luxury</option>
                <option value="Minimal">Minimal</option>
                <option value="Persuasive">Persuasive</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <s-text>Length</s-text>
              <select value={length} onChange={(e) => setLength(e.target.value)} style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', marginTop: '4px'}}>
                <option value="Short">Short (1-2 sentences)</option>
                <option value="Medium">Medium (1 paragraph)</option>
                <option value="Long">Long (Detailed with bullets)</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <s-text>Keywords (optional)</s-text>
              <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. eco-friendly, waterproof" style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', marginTop: '4px'}} />
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <button 
              onClick={handleBulkGenerate}
              disabled={progress.active || selectedIds.size === 0 || isLimitReached} 
              style={{padding: '10px 20px', background: progress.active ? '#666' : '#000', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'}}
            >
              {progress.active 
                ? `Generating (${progress.current}/${progress.total})...` 
                : `Bulk Generate (${selectedIds.size} selected)`}
            </button>
            {isLimitReached && (
              <span style={{ color: 'red', marginLeft: '10px' }}>Limit reached. Please upgrade.</span>
            )}
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Products">
        <s-stack direction="block" gap="base">
          <table style={{width: '100%', borderCollapse: 'collapse', marginTop: '10px'}}>
            <thead>
              <tr style={{textAlign: 'left', borderBottom: '2px solid #ccc', backgroundColor: '#f9f9f9'}}>
                <th style={{padding: '12px 8px'}}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.size === products.length && products.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
                <th style={{padding: '12px 8px'}}>Product</th>
                <th style={{padding: '12px 8px'}}>Status</th>
                <th style={{padding: '12px 8px'}}>Generation Result</th>
              </tr>
            </thead>
            <tbody>
              {products.map(({ node }: any) => (
                <BulkRowGenerator
                  key={node.id}
                  product={node}
                  isSelected={selectedIds.has(node.id)}
                  onToggle={handleToggleSelect}
                  shouldGenerate={processingId === node.id}
                  onComplete={handleRowComplete}
                  tone={tone}
                  length={length}
                  keywords={keywords}
                />
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px' }}>
            <button 
              disabled={!pageInfo.hasPreviousPage}
              onClick={() => navigate(`?cursor=${pageInfo.startCursor}&direction=prev`)}
              style={{padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', cursor: pageInfo.hasPreviousPage ? 'pointer' : 'not-allowed'}}
            >
              Previous Page
            </button>
            <button 
              disabled={!pageInfo.hasNextPage}
              onClick={() => navigate(`?cursor=${pageInfo.endCursor}&direction=next`)}
              style={{padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', cursor: pageInfo.hasNextPage ? 'pointer' : 'not-allowed'}}
            >
              Next Page
            </button>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
