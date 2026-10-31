import Link from "next/link";

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav aria-label="Catalog" className="flex flex-wrap gap-4 text-sm">
        <Link href="/catalog/service-types" className="font-medium text-emerald-900 hover:underline">
          Service types
        </Link>
        <Link href="/catalog/products" className="font-medium text-emerald-900 hover:underline">
          Products
        </Link>
      </nav>
      {children}
    </>
  );
}
