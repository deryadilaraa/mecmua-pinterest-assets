import { readFile, writeFile } from "node:fs/promises";

const BASE_URL = (process.env.PIN_SITE_BASE_URL || "https://mecmua.world").replace(/\/+$/, "");
const source = await readFile("assets/pin-queue.csv", "utf8");

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else if (char !== "\r") value += char;
  }
  if (value || row.length) { row.push(value); if (row.some(Boolean)) rows.push(row); }
  const [headers, ...records] = rows;
  if (!headers) throw new Error("Queue CSV is empty.");
  return records.map(record => Object.fromEntries(headers.map((key, i) => [key, record[i] || ""])));
}

function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 0x01000193); }
  return (value >>> 0).toString(16).padStart(8, "0");
}
function escapeXml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
const entries = parseCsv(source);
const required = ["image_url", "theme", "pin_title", "destination_link", "merchant"];
if (entries.some(entry => required.some(key => !entry[key]))) throw new Error("Queue row is missing a required field.");
const occurrences = new Map();
const pins = entries.map(entry => {
  const key = [entry.image_url, entry.destination_link, entry.pin_title].join("\n");
  const count = (occurrences.get(key) || 0) + 1;
  occurrences.set(key, count);
  return { ...entry, id: `pin-${hash(key)}${count > 1 ? `-${count}` : ""}` };
});
const now = Date.now();
const items = pins.map((pin, index) => {
  const extension = new URL(pin.image_url).pathname.toLowerCase().split(".").pop();
  const imageType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  const description = `A curated ${pin.theme.replace(/-/g, " ")} find from mecmua. Explore this ${pin.pin_title} from ${pin.merchant} via ShopMy.`;
  const link = `${BASE_URL}/pin.html?id=${encodeURIComponent(pin.id)}`;
  const pubDate = new Date(now - (pins.length - index - 1) * 60_000).toUTCString();
  return `    <item>
      <title>${escapeXml(pin.pin_title)}</title>
      <description>${escapeXml(description)}</description>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${pin.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${escapeXml(pin.image_url)}" type="${imageType}" />
      <media:content url="${escapeXml(pin.image_url)}" medium="image" type="${imageType}" />
    </item>`;
}).join("\n");
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>mecmua — curated finds</title>
    <link>${BASE_URL}/</link>
    <description>Curated finds from mecmua. Product links may be affiliate links.</description>
    <language>en</language>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
await writeFile("feed.xml", feed, "utf8");
await writeFile("pins.json", JSON.stringify(pins, null, 2) + "\n", "utf8");
console.log(`Generated feed.xml and pins.json for ${pins.length} pins.`);
