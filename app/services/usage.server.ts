import prisma from "../db.server";

export async function getShopPlanDetails(shopDomain: string) {
  let settings = await prisma.shopSettings.findUnique({
    where: { shopDomain },
  });

  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: {
        shopDomain,
        plan: "free",
      },
    });
  }

  return settings;
}

export async function getMonthlyUsage(shopDomain: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  let usage = await prisma.usageCounter.findFirst({
    where: {
      shopDomain,
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
  });

  if (!usage) {
    // Determine limit based on plan, default to 5000 for free plan (test app)
    const settings = await getShopPlanDetails(shopDomain);
    const limit = settings.plan === "free" ? 5000 : 50000;

    usage = await prisma.usageCounter.create({
      data: {
        shopDomain,
        periodStart: startOfMonth,
        periodEnd: endOfMonth,
        generationsUsed: 0,
        generationsLimit: limit,
      },
    });
  }

  return usage;
}

export async function incrementUsage(shopDomain: string) {
  const usage = await getMonthlyUsage(shopDomain);
  if (usage.generationsUsed >= usage.generationsLimit) {
    throw new Error("Monthly generation limit reached. Please upgrade your plan.");
  }

  await prisma.usageCounter.update({
    where: { id: usage.id },
    data: {
      generationsUsed: {
        increment: 1,
      },
    },
  });
}

export async function logGenerationEvent(data: {
  shopDomain: string;
  productId: string;
  productTitle: string;
  promptSettings: any;
  inputText: string;
  outputText: string;
  previousDescription: string;
}) {
  return await prisma.generation.create({
    data: {
      shopDomain: data.shopDomain,
      productId: data.productId,
      productTitle: data.productTitle,
      promptSettings: JSON.stringify(data.promptSettings),
      inputText: data.inputText,
      outputText: data.outputText,
      previousDescription: data.previousDescription,
      status: "draft",
    },
  });
}

export async function updateGenerationStatus(id: string, status: string) {
  return await prisma.generation.update({
    where: { id },
    data: {
      status,
      appliedAt: status === "applied" ? new Date() : null,
    },
  });
}
