# PinThread: one container serving the API, the outbox/pool workers and the built web app.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/web/package.json apps/web/package.json
RUN pnpm install --prod --frozen-lockfile --filter "@pinthread/server..."
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/server.mjs"]
