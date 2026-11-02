import "react";

declare module "react" {
  interface CSSProperties {
    /** A list item's place in a staggered reveal (app/motion.css `.stagger`); a style attribute, which the CSP allows. */
    "--i"?: number;
  }
}
