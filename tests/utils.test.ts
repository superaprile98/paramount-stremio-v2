import { describe, it, expect } from "vitest";
import { pickManifestUrl, isLicenseUrl } from "@/lib/paramount/utils";

describe("utils: pickManifestUrl", () => {
    it("picks streamingUrl when it is a manifest", () => {
        const resp = { streamingUrl: "https://cdn.example.com/master.m3u8" };
        expect(pickManifestUrl(resp)).toBe("https://cdn.example.com/master.m3u8");
    });

    it("picks hls.url", () => {
        const resp = { hls: { url: "https://cdn.example.com/master.m3u8" } };
        expect(pickManifestUrl(resp)).toBe("https://cdn.example.com/master.m3u8");
    });

    it("picks mpd manifests too", () => {
        const resp = { playback: { url: "https://cdn.example.com/manifest.mpd" } };
        expect(pickManifestUrl(resp)).toBe("https://cdn.example.com/manifest.mpd");
    });

    it("walks nested objects to find a manifest URL", () => {
        const resp = {
            data: {
                playback: {
                    sources: [{ url: "https://cdn.example.com/video.m3u8" }],
                },
            },
        };
        expect(pickManifestUrl(resp)).toBe("https://cdn.example.com/video.m3u8");
    });

    it("returns null when only a license URL is present", () => {
        const resp = { licenseUrl: "https://lic.example.com/widevine/getlicense" };
        expect(pickManifestUrl(resp)).toBeNull();
    });

    it("returns null for empty responses", () => {
        expect(pickManifestUrl({})).toBeNull();
        expect(pickManifestUrl(null)).toBeNull();
        expect(pickManifestUrl(undefined)).toBeNull();
    });
});

describe("utils: isLicenseUrl", () => {
    it("detects widevine license URLs", () => {
        expect(isLicenseUrl("https://lic.example.com/widevine/getlicense")).toBe(true);
        expect(isLicenseUrl("https://lic.example.com/GetLicense?token=x")).toBe(true);
    });

    it("rejects non-license URLs", () => {
        expect(isLicenseUrl("https://cdn.example.com/master.m3u8")).toBe(false);
    });
});