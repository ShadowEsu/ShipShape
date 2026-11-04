import "react";

declare module "react" {
  interface CSSProperties {
    /** A list item's place in a staggered reveal (app/motion.css `.stagger`); a style attribute, which the CSP allows. */
    "--i"?: number;
    /** Each glass tab's width, from its longest label (components/glass.tsx `GlassTabs`); a style attribute too. */
    "--glass-tab-width"?: string;
  }
}
