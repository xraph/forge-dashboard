const identity = {
  namespace: "production",
  serviceID: "billing",
  instanceID: "billing-01",
}
const delivery = {
  stream: "orders",
  consumerID: "billing-process",
  subscriptionID: "process-orders",
  destination: identity,
  mode: "competing",
  attempt: 5,
  sequence: 31,
}
let letters = []
let events = []
export function resetConduit() {
  letters = [
    {
      id: "billing-process_order-31",
      messageID: "order-31",
      messageType: "orders.placed.v1",
      delivery,
      failedAt: new Date().toISOString(),
      replayed: false,
    },
  ]
  events = [
    {
      stage: "deadletter.stored",
      identity,
      delivery,
      message: { id: "order-31", type: "orders.placed.v1" },
      at: new Date().toISOString(),
    },
  ]
}
resetConduit()
export function createConduitHandlers(FixtureError) {
  const read = (handler) => ({
    kind: "query",
    version: 1,
    capability: "read",
    handler,
  })
  const snapshot = () => ({
    identity,
    running: true,
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    published: 72,
    handled: 68,
    acknowledged: 68,
    failed: 5,
    retried: 4,
    deadLettered: 1,
    observerDrops: 0,
    providers: [
      {
        name: "events",
        type: "nats-jetstream",
        healthy: true,
        capabilities: {
          durable: true,
          replay: true,
          deadLetters: true,
          keyOrdering: false,
        },
      },
    ],
    streams: [
      {
        config: {
          name: "orders",
          provider: "events",
          subjects: ["orders.>"],
          maxAge: 604800000000000,
          maxMessages: 100000,
          replicas: 3,
        },
        messages: 72,
        bytes: 24322,
        consumers: 4,
      },
    ],
    subscriptions: [
      {
        id: "process-orders",
        stream: "orders",
        messageType: "orders.placed.v1",
        mode: "competing",
        durable: true,
        concurrency: 4,
        maxInFlight: 16,
        timeout: 30000000000,
        maxAttempts: 5,
        retryDelay: 1000000000,
        startAt: "all",
      },
      {
        id: "refresh-cache",
        stream: "orders",
        messageType: "orders.placed.v1",
        mode: "broadcast",
        durable: false,
        concurrency: 1,
        maxInFlight: 1,
        timeout: 30000000000,
        maxAttempts: 3,
        retryDelay: 1000000000,
        startAt: "new",
      },
    ],
  })
  return {
    overview: read(snapshot),
    "services.list": read(() => ({
      instances: ["billing-01", "billing-02", "billing-03"].map(
        (instanceID) => ({
          identity: { ...identity, instanceID },
          version: "1.0.0",
          ready: true,
          endpoints: [
            { protocol: "https", url: `https://${instanceID}.internal:8443` },
          ],
        })
      ),
    })),
    "hooks.list": read(() => ({ events: structuredClone(events) })),
    "deadletters.list": read((payload) => {
      if (payload?.provider !== "events")
        throw new FixtureError(404, "NOT_FOUND", "Provider not found")
      const limit = payload.limit || 25
      const found = letters.filter(
        (l) =>
          (!payload.subscription ||
            l.delivery.subscriptionID === payload.subscription) &&
          l.id > (payload.cursor || "")
      )
      return {
        letters: structuredClone(found.slice(0, limit)),
        nextCursor: found.length > limit ? found[limit - 1].id : "",
      }
    }),
    "deadletters.replay": {
      kind: "command",
      version: 1,
      capability: "write",
      invalidates: ["overview", "deadletters.list", "hooks.list"],
      handler: (payload) => {
        const letter = letters.find(
          (l) =>
            payload?.provider === "events" &&
            l.id === payload.id &&
            l.delivery.subscriptionID === payload.subscription
        )
        if (!letter)
          throw new FixtureError(404, "NOT_FOUND", "Dead letter not found")
        if (letter.replayed)
          throw new FixtureError(409, "CONFLICT", "Event was already replayed")
        letter.replayed = true
        events.push({
          stage: "deadletter.replayed",
          identity,
          message: { id: letter.messageID, type: letter.messageType },
          at: new Date().toISOString(),
        })
        return {
          messageID: letter.messageID,
          sequence: 73,
          persisted: true,
          duplicate: false,
        }
      },
    },
  }
}
