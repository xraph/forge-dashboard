# shadcn/ui monorepo template

This is a Vite monorepo template with shadcn/ui.

## Adding components

To add components to your app, run the following command at the root of your `playground` app:

```bash
pnpm dlx shadcn@latest add button -c apps/playground
```

This will place the ui components in the `packages/kit/src/components` directory.

## Using components

To use the components in your app, import them from the `kit` package.

```tsx
import { Button } from "@forge/dashboard-kit/components/button";
```
