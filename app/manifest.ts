import type { MetadataRoute } from "next";

/** The web app manifest: the name and Design's 512 px app icon (public/brand), for "Add to Home Screen" and installs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ShipShape",
    short_name: "ShipShape",
    start_url: "/app",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
