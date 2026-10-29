import { assetsApi } from "@/lib/api/assets";

export function assetFullImageUrl(asset: { id: string; version?: string | null }): string {
  return assetsApi.contentUrl(asset.id, asset.version);
}

export function assetImageUrl(asset: { id: string; version?: string | null; thumbnail_url?: string | null }): string {
  return asset.thumbnail_url ? assetsApi.thumbnailUrl(asset.id, asset.version) : assetFullImageUrl(asset);
}
