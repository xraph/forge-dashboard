// React Flow's stylesheet is imported for its side effect, by the lazy graph
// canvas alone, so it ships in that chunk. TypeScript wants the module named.
declare module "@xyflow/react/dist/style.css"
