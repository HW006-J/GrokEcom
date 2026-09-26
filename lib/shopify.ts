// Shopify Admin GraphQL via plain fetch. Every function degrades to null when env is missing.
const API_VERSION = '2026-07';

export function shopifyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN);
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) throw new Error('Shopify env not set');
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) {
    throw new Error(`Shopify: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data as T;
}

const numericId = (gid: string) => gid.split('/').pop() ?? gid;

export type ShopifyProduct = { productId: string; variantId: string };

export async function createProduct(input: {
  title: string;
  descriptionHtml: string;
  vendor: string | null;
  price: number;
  imageUrl?: string;
}): Promise<ShopifyProduct> {
  type CreateData = {
    productCreate: {
      product: { id: string; variants: { nodes: { id: string }[] } } | null;
      userErrors: { message: string }[];
    };
  };
  const created = await gql<CreateData>(
    `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id variants(first: 1) { nodes { id } } }
        userErrors { message }
      }
    }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        vendor: input.vendor ?? undefined,
        status: 'ACTIVE',
      },
      media: input.imageUrl
        ? [{ originalSource: input.imageUrl, mediaContentType: 'IMAGE', alt: input.title }]
        : undefined,
    },
  );
  const p = created.productCreate;
  if (!p.product) throw new Error(`productCreate: ${p.userErrors.map((e) => e.message).join('; ')}`);
  const productId = p.product.id;
  const variantGid = p.product.variants.nodes[0]?.id;
  if (!variantGid) throw new Error('productCreate returned no default variant');

  type PriceData = { productVariantsBulkUpdate: { userErrors: { message: string }[] } };
  const priced = await gql<PriceData>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
    }`,
    { productId, variants: [{ id: variantGid, price: input.price.toFixed(2) }] },
  );
  if (priced.productVariantsBulkUpdate.userErrors.length) {
    console.warn('Shopify price update:', priced.productVariantsBulkUpdate.userErrors);
  }
  return { productId: numericId(productId), variantId: numericId(variantGid) };
}

export async function createDraftOrderInvoice(input: {
  variantId: string;
  amount: number;
  buyerName: string;
  itemTitle: string;
}): Promise<string | null> {
  type DraftData = {
    draftOrderCreate: { draftOrder: { invoiceUrl: string | null } | null; userErrors: { message: string }[] };
  };
  const data = await gql<DraftData>(
    `mutation($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) { draftOrder { invoiceUrl } userErrors { message } }
    }`,
    {
      input: {
        note: `ClosetLive auction win: ${input.itemTitle} by ${input.buyerName}`,
        tags: ['closetlive', 'auction'],
        lineItems: [
          {
            variantId: `gid://shopify/ProductVariant/${input.variantId}`,
            quantity: 1,
            priceOverride: { amount: input.amount.toFixed(2), currencyCode: 'GBP' },
          },
        ],
      },
    },
  );
  const d = data.draftOrderCreate;
  if (!d.draftOrder) throw new Error(`draftOrderCreate: ${d.userErrors.map((e) => e.message).join('; ')}`);
  return d.draftOrder.invoiceUrl;
}
