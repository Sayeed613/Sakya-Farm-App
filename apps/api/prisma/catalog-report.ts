// Read-only catalog report: what the database actually holds, per category.
// Usage: pnpm --filter @sakya/api catalog:report
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/env.validation';

async function main() {
  validateEnvironment(process.env);

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? '',
    max: 2,
  });
  const prisma = new PrismaClient({ adapter });

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
    select: {
      slug: true,
      name: true,
      parentId: true,
      products: {
        select: {
          isPrimary: true,
          product: {
            select: {
              isAvailable: true,
              status: true,
              variants: { select: { isAvailable: true } },
            },
          },
        },
      },
    },
  });

  const rows = categories.map((category) => {
    const purchasable = category.products.filter(
      (link) =>
        link.product.isAvailable && link.product.variants.some((variant) => variant.isAvailable),
    ).length;
    return {
      slug: category.slug,
      name: category.name,
      parent: category.parentId,
      linked: category.products.length,
      purchasable,
    };
  });

  console.log('CATEGORIES (slug | name | parent | linked | purchasable)');
  for (const row of rows) {
    console.log(
      `${row.slug} | ${row.name} | ${row.parent ?? '-'} | ${row.linked} | ${row.purchasable}`,
    );
  }

  const products = await prisma.product.findMany({
    select: {
      slug: true,
      title: true,
      isAvailable: true,
      status: true,
      variants: { select: { isAvailable: true, priceInPaise: true } },
      categories: {
        select: { isPrimary: true, category: { select: { slug: true } } },
        orderBy: { position: 'asc' },
      },
    },
  });

  console.log('\nPRODUCTS (slug | primary | all-links | avail | purchasable-variants)');
  for (const product of products) {
    const purchasableVariants = product.variants.filter((variant) => variant.isAvailable).length;
    const links = product.categories.map((link) => link.category.slug).join(',');
    const primary = product.categories.find((link) => link.isPrimary)?.category.slug ?? '-';
    console.log(
      `${product.slug} | ${primary} | ${links} | ${product.isAvailable} | ${purchasableVariants}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
