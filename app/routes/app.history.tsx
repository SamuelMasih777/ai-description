import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const history = await prisma.generation.findMany({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return { history };
};

export default function History() {
  const { history } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Generation History">
      <TitleBar title="History" />
      
      <s-section heading="History">
        <s-stack direction="block" gap="base">
              {history.length === 0 ? (
                <s-text>No generations yet.</s-text>
              ) : (
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                  <thead>
                    <tr style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>
                      <th style={{padding: '8px'}}>Date</th>
                      <th style={{padding: '8px'}}>Product</th>
                      <th style={{padding: '8px'}}>Status</th>
                      <th style={{padding: '8px'}}>Settings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => {
                      const settings = item.promptSettings ? JSON.parse(item.promptSettings as string) : {};
                      return (
                        <tr key={item.id} style={{borderBottom: '1px solid #eee'}}>
                          <td style={{padding: '8px'}}>{new Date(item.createdAt).toLocaleDateString()}</td>
                          <td style={{padding: '8px'}}>{item.productTitle || "Unknown"}</td>
                          <td style={{padding: '8px'}}>
                            {/* s-badge might not be registered, use a span if it breaks, but App Bridge usually has s-badge */}
                            <span style={{
                              padding: '2px 8px', 
                              borderRadius: '10px', 
                              backgroundColor: item.status === "applied" ? '#e3f1df' : '#e4f0f6',
                              color: item.status === "applied" ? '#1a5e20' : '#005a8b',
                              fontSize: '0.85em'
                            }}>
                              {item.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{padding: '8px'}}>
                            <span>{settings.tone} / {settings.length}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
