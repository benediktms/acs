declare module "*.sql" {
  const content: string;
  export default content;
}

declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*CODEX_VERSION" {
  const content: string;
  export default content;
}
