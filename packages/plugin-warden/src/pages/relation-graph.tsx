import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { RelationGraph } from "../components/relation-graph"
import { relationGraphPath } from "../components/relation-graph-path"
import type { RelationExpansion } from "../components/relation-graph"
import { namespaceOptions } from "../components/namespace-filter"
import type { NamespacesResponse } from "../components/namespace-filter"

const ALWAYS =
  "Tuples only. Permissions defined by a resource type's expression are evaluated outside this walk."
const OWN_WALKER =
  "This deployment installs its own graph walker, so a check may walk differently from what is drawn."

/** The sentence for why the walk ended, which is also what is missing. */
function stopSentence(expansion: RelationExpansion, root: string): string {
  // When the deployment installs its own walker, the engine runs this
  // expansion with a fallback walker built from Warden's config, while a check
  // walks with the installed one, whose limits the response does not know. So
  // the limit named is the config's, never "the engine's".
  const whose = expansion.exactWalk
    ? "the engine's limit"
    : "the limit set in Warden's config"
  switch (expansion.stop) {
    case "complete":
      // A complete walk reached every tuple, but the cap can leave some of
      // what it reached undrawn, and then "is shown" would be false.
      return expansion.truncatedNodes > 0
        ? `The walk reached every tuple from ${root}.`
        : `Every tuple reachable from ${root} is shown.`
    case "depth":
      return `Stopped at depth ${expansion.limit}, ${whose}. Relations beyond it are not shown.`
    case "visited":
      // The walker counts the object relations it walks (type:id#relation), not
      // every node it draws, so "nodes" would be the wrong unit.
      return `Stopped after walking ${expansion.limit} object relations, ${whose}. More may be reachable.`
    case "fanout":
      return `Stopped where one relation has ${expansion.limit} or more tuples, ${whose}. The walk ends there, so what it had not yet reached is not shown.`
  }
  return ""
}

function View({
  expansion,
  root,
  subject,
}: {
  expansion: RelationExpansion
  root: string
  subject: string | null
}) {
  const stop = stopSentence(expansion, root)
  const path = expansion.path ?? []
  // "The engine's walk" is a claim that this is what a check does. It is only
  // true when the walker is the built-in one. Otherwise the drawing is what
  // warden's default walk finds, and the page says that.
  const heading = expansion.exactWalk
    ? `The engine's walk reaches ${subject} this way:`
    : `Warden's default walk reaches ${subject} this way:`
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        {stop && <p>{stop}</p>}
        <p>{ALWAYS}</p>
        {expansion.truncatedNodes > 0 && (
          <p>
            {`Showing ${expansion.nodes.length} of ${expansion.nodes.length + expansion.truncatedNodes} nodes. ${
              expansion.truncatedNodes === 1
                ? "1 more was reached but is not drawn."
                : `${expansion.truncatedNodes} more were reached but are not drawn.`
            }`}
          </p>
        )}
        {!expansion.exactWalk && <p>{OWN_WALKER}</p>}
      </div>

      {subject !== null &&
        (path.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>{heading}</p>
            <p className="font-mono text-xs">{path.join(" then ")}</p>
          </div>
        ) : (
          <p className="text-sm">{`The walk did not reach ${subject} within these limits.`}</p>
        ))}

      <RelationGraph expansion={expansion} />
    </div>
  )
}

/**
 * One object's relation expanded: the tuples reachable from it, drawn.
 *
 * Reached at `/relations/graph/:objectType/:objectId/:relation`, with
 * `/to/:subjectType/:subjectId` to ask for the path to one subject and
 * `/in/:namespace` to start somewhere other than the tenant root. A plugin
 * cannot read a query string, so every part is a path segment.
 */
export function WardenRelationGraphPage({ params }: PluginPageProps) {
  const objectType = params.objectType ?? ""
  const objectId = params.objectId ?? ""
  const relation = params.relation ?? ""
  const subjectType = params.subjectType
  const subjectId = params.subjectId
  const asked = subjectType !== undefined && subjectId !== undefined
  const root = `${objectType}:${objectId}#${relation}`

  // The route is the namespace, so a reload or a shared link keeps it, and
  // the control navigates instead of holding a state of its own.
  const namespace = params.namespace ?? ""
  const navigate = useNavigateTo()
  const namespaces = useQuery<NamespacesResponse>("namespaces.list")
  const known = namespaces.data?.namespaces ?? [""]
  // The route may name a namespace the list does not hold; keep it selectable.
  const options = namespaceOptions(
    known.includes(namespace) ? known : [...known, namespace]
  ).filter((o) => o.value !== "all")

  const expansion = useQuery<RelationExpansion>("relations.expand", {
    objectType,
    objectId,
    relation,
    namespacePath: namespace,
    ...(asked ? { pathToType: subjectType, pathToId: subjectId } : {}),
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Relation graph"
        description={`The tuples reachable from ${root}, as warden's relation walk finds them.`}
        actions={
          <PluginLink
            to="/relations"
            className="text-sm underline underline-offset-4"
          >
            All relations
          </PluginLink>
        }
      />

      <div className="flex items-center gap-1.5">
        <Label
          htmlFor="relation-graph-namespace"
          className="text-xs text-muted-foreground"
        >
          Namespace
        </Label>
        <NativeSelect
          id="relation-graph-namespace"
          value={namespace}
          onChange={(e) =>
            navigate(
              relationGraphPath({
                objectType,
                objectId,
                relation,
                subject: asked
                  ? { type: subjectType, id: subjectId }
                  : undefined,
                namespace: e.target.value,
              })
            )
          }
        >
          {options.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <QueryBoundary title="Relation graph" query={expansion} skeletonRows={5}>
        {(data) => (
          <View
            expansion={data}
            root={root}
            subject={asked ? `${subjectType}:${subjectId}` : null}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
