import type { JsonObject } from "../../types";
import {
  RESOURCE_SPECS,
  resourceParameterSpecs,
} from "./resource-specs";

export {
  RESOURCE_SPECS,
  resourceParameterSpecs,
  resourceSpecForUri,
  type ParsedResourceQuery,
  type RegisteredResourceSpec,
  type ResourceHandlerId,
} from "./resource-specs";
export { parseResourceUri, validateResourceUri } from "./resource-uri";

export function resourceList(): JsonObject {
  return {
    resources: RESOURCE_SPECS
      .filter((spec) => resourceParameterSpecs(spec).length === 0)
      .map((spec) => ({
        uri: spec.uri,
        name: spec.name,
        description: spec.description,
        mimeType: "application/json",
      })),
  };
}

export function resourceTemplatesList(): JsonObject {
  return {
    resourceTemplates: RESOURCE_SPECS
      .filter((spec) => resourceParameterSpecs(spec).length > 0)
      .map((spec) => ({
        uriTemplate: `${spec.uri}{?${resourceParameterSpecs(spec).map((parameter) => parameter.name).join(",")}}`,
        name: spec.name,
        description: spec.description,
        mimeType: "application/json",
      })),
  };
}
