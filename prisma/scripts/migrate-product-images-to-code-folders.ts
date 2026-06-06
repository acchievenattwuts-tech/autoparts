import { db } from "@/lib/db";
import {
  PRODUCT_IMAGE_BUCKET,
  buildPublicProductImageUrl,
  getProductImageFolder,
  getProductImageObjectPathFromPublicUrl,
  isProductImageObjectPath,
  isProductImageObjectPathForCode,
  createProductImageStorageClient,
  getProductImageStorageConfig,
} from "@/lib/product-image-storage";

type Mode = "dry-run" | "apply";
type RefKind = "product" | "productImage";

type ProductImageRef = {
  kind: RefKind;
  productId: string;
  productImageId?: string;
  productCode: string;
  productName: string;
  oldUrl: string;
  oldPath: string;
  newPath: string;
  newUrl: string;
};

const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

const getSafeBasename = (objectPath: string): string => {
  const basename = objectPath.split("/").pop()?.trim() ?? "";
  return basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image.jpg";
};

const splitExtension = (basename: string): { name: string; ext: string } => {
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === basename.length - 1) {
    return { name: basename, ext: "" };
  }

  return {
    name: basename.slice(0, dotIndex),
    ext: basename.slice(dotIndex),
  };
};

const buildUniqueDestinationPath = ({
  productCode,
  oldPath,
  usedPaths,
}: {
  productCode: string;
  oldPath: string;
  usedPaths: Set<string>;
}): string => {
  const folder = getProductImageFolder(productCode);
  const basename = getSafeBasename(oldPath);
  const firstPath = `${folder}/${basename}`;
  if (!usedPaths.has(firstPath)) {
    usedPaths.add(firstPath);
    return firstPath;
  }

  const { name, ext } = splitExtension(basename);
  for (let index = 2; index < 10_000; index += 1) {
    const nextPath = `${folder}/${name}-${index}${ext}`;
    if (!usedPaths.has(nextPath)) {
      usedPaths.add(nextPath);
      return nextPath;
    }
  }

  throw new Error(`Unable to build a unique image path for ${oldPath}`);
};

async function buildPlan(): Promise<ProductImageRef[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  }
  const products = await db.product.findMany({
    orderBy: [{ code: "asc" }, { id: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      imageUrl: true,
      images: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, url: true },
      },
    },
  });

  const refs: ProductImageRef[] = [];
  const usedPaths = new Set<string>();
  const destinationBySource = new Map<string, string>();

  const addRef = ({
    kind,
    productId,
    productImageId,
    productCode,
    productName,
    oldUrl,
  }: Omit<ProductImageRef, "oldPath" | "newPath" | "newUrl">) => {
    const oldPath = getProductImageObjectPathFromPublicUrl(oldUrl);
    if (!oldPath || !isProductImageObjectPath(oldPath)) {
      return;
    }

    if (isProductImageObjectPathForCode(oldPath, productCode)) {
      return;
    }

    const sourceKey = `${productCode}|${oldPath}`;
    const newPath =
      destinationBySource.get(sourceKey) ??
      buildUniqueDestinationPath({
        productCode,
        oldPath,
        usedPaths,
      });
    destinationBySource.set(sourceKey, newPath);

    refs.push({
      kind,
      productId,
      productImageId,
      productCode,
      productName,
      oldUrl,
      oldPath,
      newPath,
      newUrl: buildPublicProductImageUrl(supabaseUrl, newPath),
    });
  };

  for (const product of products) {
    if (product.imageUrl) {
      addRef({
        kind: "product",
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        oldUrl: product.imageUrl,
      });
    }

    for (const image of product.images) {
      addRef({
        kind: "productImage",
        productId: product.id,
        productImageId: image.id,
        productCode: product.code,
        productName: product.name,
        oldUrl: image.url,
      });
    }
  }

  return refs;
}

async function copyStorageObjects(refs: ProductImageRef[]) {
  const storageConfig = getProductImageStorageConfig();
  if (!storageConfig) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const client = createProductImageStorageClient(storageConfig);
  const copies = new Map<string, { oldPath: string; newPath: string }>();
  for (const ref of refs) {
    copies.set(`${ref.oldPath}|${ref.newPath}`, { oldPath: ref.oldPath, newPath: ref.newPath });
  }

  let copied = 0;
  for (const copy of copies.values()) {
    const { error } = await client.storage.from(PRODUCT_IMAGE_BUCKET).copy(copy.oldPath, copy.newPath);
    if (error) {
      const message = error.message.toLowerCase();
      const alreadyExists = message.includes("already exists") || message.includes("duplicate");
      if (!alreadyExists) {
        throw new Error(`Copy failed: ${copy.oldPath} -> ${copy.newPath}: ${error.message}`);
      }
    }

    copied += 1;
    console.log(`  copied ${copied}/${copies.size}: ${copy.oldPath} -> ${copy.newPath}`);
  }
}

async function rewriteDatabaseRefs(refs: ProductImageRef[]) {
  let productUpdates = 0;
  let productImageUpdates = 0;

  for (const ref of refs) {
    if (ref.kind === "product") {
      const result = await db.product.updateMany({
        where: { id: ref.productId, imageUrl: ref.oldUrl },
        data: { imageUrl: ref.newUrl },
      });
      productUpdates += result.count;
      continue;
    }

    if (!ref.productImageId) {
      continue;
    }

    const result = await db.productImage.updateMany({
      where: { id: ref.productImageId, url: ref.oldUrl },
      data: { url: ref.newUrl },
    });
    productImageUpdates += result.count;
  }

  return { productUpdates, productImageUpdates };
}

async function main() {
  const mode = getMode();
  console.log(`\nProduct image folder migration mode: ${mode.toUpperCase()}\n`);

  const refs = await buildPlan();
  const uniqueCopies = new Set(refs.map((ref) => `${ref.oldPath}|${ref.newPath}`)).size;

  console.log(`References to rewrite: ${refs.length}`);
  console.log(`Storage objects to copy: ${uniqueCopies}`);

  if (refs.length > 0) {
    console.log("\nPlanned changes:");
    for (const ref of refs) {
      console.log(
        `  [${ref.productCode}] ${ref.productName} (${ref.kind})\n    ${ref.oldPath}\n    -> ${ref.newPath}`,
      );
    }
  }

  if (mode === "dry-run") {
    console.log("\nDry-run complete. Re-run with --apply to copy files and rewrite DB URLs.\n");
    return;
  }

  if (refs.length === 0) {
    console.log("\nNo product image URLs need migration.\n");
    return;
  }

  console.log("\nCopying storage objects...");
  await copyStorageObjects(refs);

  console.log("\nRewriting database URLs...");
  const result = await rewriteDatabaseRefs(refs);
  console.log(
    `Updated Product.imageUrl rows: ${result.productUpdates}. Updated ProductImage.url rows: ${result.productImageUpdates}.`,
  );

  console.log("\nDone. Re-run this script without --apply to confirm no remaining old product image refs.\n");
}

main()
  .catch((error) => {
    console.error("Product image folder migration failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
