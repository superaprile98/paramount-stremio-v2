import { describe, it, expect } from "vitest";
import { rewriteMpd } from "@/lib/paramount/proxy/mpd";

/**
 * Struttura MPD reale dei replay Paramount+ (VOD DASH CENC su
 * vod.pplus.paramount.tech): SegmentTemplate con placeholder $Number$ e
 * $RepresentationID$ che il player sostituisce sull'URL finale.
 */
const REAL_MPD = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <SegmentTemplate media="seg_$Number$.m4s" initialization="init_$RepresentationID$.m4s" startNumber="1" timescale="90000" duration="5400000"/>
      <Representation id="v_720p" bandwidth="2196000" width="1280" height="720"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <SegmentTemplate media="aseg_$Number$.m4s" initialization="ainit_$RepresentationID$.m4s" startNumber="1" timescale="48000" duration="2880000"/>
      <Representation id="a_it" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const UPSTREAM = new URL("https://vod.pplus.paramount.tech/intl_vms/2026/08/05/ALVE01KZ/4492635_cenc_precon_dash/ITSA_Match_Replay_720p/manifest.mpd");

describe("rewriteMpd — placeholder DASH", () => {
    const rewritten = rewriteMpd({
        text: REAL_MPD,
        upstreamUrl: UPSTREAM,
        baseOrigin: "https://para.example.com",
        sid: "TESTSID1234567890",
    });

    it("lascia i placeholder leggibili nell'URL del proxy (fuori dal base64)", () => {
        // i template ($Number$/$RepresentationID$) restano letterali; il
        // prefisso ("seg_", "init_", ...) è invece nel base64 di `u`
        expect(rewritten).toContain("$Number$.m4s");
        expect(rewritten).toContain("$RepresentationID$.m4s");
        // il placeholder NON deve essere percent-encoded
        expect(rewritten).not.toContain("%24Number%24");
        expect(rewritten).not.toContain("%24RepresentationID%24");
    });

    it("codifica il prefisso in `u` e il template in `s`", () => {
        // media del primo AdaptationSet (video): .../seg_$Number$.m4s
        const m = rewritten.match(/<SegmentTemplate[^>]*\bmedia="([^"]+)"/);
        expect(m).toBeTruthy();
        const url = new URL(m![1]);
        expect(url.pathname).toBe("/api/proxy/TESTSID1234567890/seg");
        const u = url.searchParams.get("u");
        const s = url.searchParams.get("s");
        expect(u).toBeTruthy();
        expect(s).toBe("$Number$.m4s");
        // il prefisso decodificato è l'URL CDN fino al primo `$`
        const decoded = Buffer.from(u!, "base64url").toString("utf-8");
        expect(decoded).toBe(
            "https://vod.pplus.paramount.tech/intl_vms/2026/08/05/ALVE01KZ/4492635_cenc_precon_dash/ITSA_Match_Replay_720p/seg_"
        );
        // ricostruzione: prefisso + parte sostituita dal player
        expect(decoded + "42.m4s").toBe(
            "https://vod.pplus.paramount.tech/intl_vms/2026/08/05/ALVE01KZ/4492635_cenc_precon_dash/ITSA_Match_Replay_720p/seg_42.m4s"
        );
    });

    it("mantiene $RepresentationID$ leggibile per initialization", () => {
        const m = rewritten.match(/initialization="([^"]+)"/);
        expect(m).toBeTruthy();
        const url = new URL(m![1]);
        expect(url.searchParams.get("s")).toBe("$RepresentationID$.m4s");
    });
});

describe("rewriteMpd — URL senza placeholder", () => {
    it("BaseURL e laurl restano in `u` senza `s`", () => {
        const mpd = `<?xml version="1.0"?>
<MPD>
  <BaseURL>https://cdn.example.com/base/</BaseURL>
  <ms:laurl>https://license.example.com/wv</ms:laurl>
</MPD>`;
        const rewritten = rewriteMpd({
            text: mpd,
            upstreamUrl: UPSTREAM,
            baseOrigin: "https://para.example.com",
            sid: "SID",
        });
        expect(rewritten).toContain("/api/proxy/SID/seg?u=");
        expect(rewritten).toContain("/api/proxy/SID/license?u=");
        expect(rewritten).not.toContain("&s=");
    });
});