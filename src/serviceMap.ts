import { mongo } from "./mongo";
import { WithId } from "mongodb";
import { EventEmitter } from "events";
import { ServiceMapWebSocket } from "./websocket";

interface EndpointHealth {
  name: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUpdated: number;
}

interface EndpointDependency {
  targetService: string;
  targetEndpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUpdated: number;
}

interface ServiceMapEntry {
  source: string;
  dependencies: string[];
  lastUpdated: number;
  lastActivity: number;
  status: 'running' | 'inactive';
  endpoints: Map<string, EndpointHealth>;
  endpointDependencies: Map<string, EndpointDependency[]>;
}

interface ServiceMapResponse {
  services: Array<{
    name: string;
    status: 'running' | 'inactive';
    lastActivity: number;
    endpoints: Array<{
      name: string;
      availability: number;
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      dependencies: Array<{
        targetService: string;
        targetEndpoint: string;
        availability: number;
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
      }>;
    }>;
  }>;
  relationships: {
    source: string;
    dependencies: string[];
  }[];
}

export class ServiceMap extends EventEmitter {
  private static instance: ServiceMap;
  private static readonly UPDATE_EVENT = 'serviceMapUpdate';
  private static wsHandler: ServiceMapWebSocket | null = null;
  private static readonly INACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds

  private constructor() {
    super();
  }

  static getInstance(): ServiceMap {
    if (!ServiceMap.instance) {
      ServiceMap.instance = new ServiceMap();
    }
    return ServiceMap.instance;
  }

  static setWebSocketHandler(handler: ServiceMapWebSocket): void {
    ServiceMap.wsHandler = handler;
  }

  /**
   * Process a resource span and extract dependencies and endpoint health
   */
  static async processResourceSpan(resourceSpan: any): Promise<Map<string, Set<string>>> {
    const serviceMapUpdates = new Map<string, Set<string>>();

    // Extract service name from resource attributes
    const serviceName = resourceSpan.resource?.attributes?.find(
      (attr: any) => attr.key === "service.name"
    )?.value?.stringValue || "unknown";

    // Process spans to find dependencies and endpoint health
    if (resourceSpan.scopeSpans) {
      await Promise.all(resourceSpan.scopeSpans.map(async (scopeSpan: any) => {
        if (scopeSpan.spans) {
          await Promise.all(scopeSpan.spans.map(async (span: any) => {
            // Look for dependencies in different ways
            let targetName: string | undefined;
            let targetEndpoint: string | undefined;

            // 1. Check for peer.service attribute (service-to-service)
            targetName = span.attributes?.find(
              (attr: any) => attr.key === "peer.service"
            )?.value?.stringValue;

            // Get target endpoint from span attributes
            targetEndpoint = span.attributes?.find(
              (attr: any) => attr.key === "peer.endpoint"
            )?.value?.stringValue || span.name;

            // 2. Check for database connections
            if (!targetName && (span.name.toLowerCase().includes('db') ||
                span.attributes?.some((attr: any) => attr.key === 'db.system' || attr.key === 'db.name'))) {
              targetName = span.attributes?.find(
                (attr: any) => attr.key === 'db.system'
              )?.value?.stringValue || 'database';
              targetEndpoint = span.attributes?.find(
                (attr: any) => attr.key === 'db.operation'
              )?.value?.stringValue || 'query';
            }

            // 3. Check for cache connections
            if (!targetName && (span.name.toLowerCase().includes('cache') ||
                span.attributes?.some((attr: any) => attr.key === 'cache.type'))) {
              targetName = span.attributes?.find(
                (attr: any) => attr.key === 'cache.type'
              )?.value?.stringValue || 'cache';
              targetEndpoint = span.attributes?.find(
                (attr: any) => attr.key === 'cache.operation'
              )?.value?.stringValue || 'get/set';
            }

            // 4. Check for API calls
            if (!targetName && (span.name.toLowerCase().includes('api') ||
                span.attributes?.some((attr: any) => attr.key === 'http.route' || attr.key === 'rpc.service'))) {
              targetName = span.attributes?.find(
                (attr: any) => attr.key === 'http.host'
              )?.value?.stringValue || span.attributes?.find(
                (attr: any) => attr.key === 'http.address'
              )?.value?.stringValue || 'api';

              if(targetName === 'api') {
                console.dir(span, { depth: null });
              }

              targetEndpoint = span.attributes?.find(
                (attr: any) => attr.key === 'http.route'
              )?.value?.stringValue || span.name;
            }

            // 5. Check for message queues
            if (!targetName && (span.name.toLowerCase().includes('queue') ||
                span.attributes?.some((attr: any) => attr.key === 'messaging.system'))) {
              targetName = span.attributes?.find(
                (attr: any) => attr.key === 'messaging.destination'
              )?.value?.stringValue || 'message_queue';
              targetEndpoint = span.attributes?.find(
                (attr: any) => attr.key === 'messaging.operation'
              )?.value?.stringValue || 'publish/subscribe';
            }

            // If we found a dependency and it's not a Redis connection
            if (targetName && !targetName.includes(":")) {
              if (!serviceMapUpdates.has(serviceName)) {
                serviceMapUpdates.set(serviceName, new Set());
              }
              serviceMapUpdates.get(serviceName)?.add(targetName);

              // Track endpoint-level dependency
              const endpointName = span.name;
              const isError = span.status?.code === 'error' || span.status?.code === 2;
              await this.updateEndpointDependency(
                serviceName,
                endpointName,
                targetName,
                targetEndpoint || 'unknown',
                isError
              );
            }

            // Track endpoint health
            const endpointName = span.name;
            const isError = span.status?.code === 'error' || span.status?.code === 2;
            await this.updateEndpointHealth(serviceName, endpointName, isError);
          }));
        }
      }));
    }

    return serviceMapUpdates;
  }

  /**
   * Update endpoint health metrics
   */
  private static async updateEndpointHealth(serviceName: string, endpointName: string, isError: boolean): Promise<void> {
    const now = Date.now();
    await mongo.collections.serviceMap.updateOne(
      { source: serviceName },
      {
        $inc: {
          [`endpoints.${endpointName}.totalRequests`]: 1,
          [`endpoints.${endpointName}.${isError ? 'failedRequests' : 'successfulRequests'}`]: 1
        },
        $set: {
          [`endpoints.${endpointName}.lastUpdated`]: now
        },
        $setOnInsert: {
          [`endpoints.${endpointName}.name`]: endpointName
        }
      },
      { upsert: true }
    );
  }

  /**
   * Update endpoint dependency metrics
   */
  private static async updateEndpointDependency(
    sourceService: string,
    sourceEndpoint: string,
    targetService: string,
    targetEndpoint: string,
    isError: boolean
  ): Promise<void> {
    const now = Date.now();
    await mongo.collections.serviceMap.updateOne(
      { source: sourceService },
      {
        $inc: {
          [`endpointDependencies.${sourceEndpoint}.${targetService}.${targetEndpoint}.totalRequests`]: 1,
          [`endpointDependencies.${sourceEndpoint}.${targetService}.${targetEndpoint}.${isError ? 'failedRequests' : 'successfulRequests'}`]: 1
        },
        $set: {
          [`endpointDependencies.${sourceEndpoint}.${targetService}.${targetEndpoint}.lastUpdated`]: now
        }
      },
      { upsert: true }
    );
  }

  /**
   * Update the service map in MongoDB with new dependencies
   */
  static async updateServiceMap(serviceMapUpdates: Map<string, Set<string>>): Promise<void> {
    if (serviceMapUpdates.size > 0) {
      const now = Date.now();
      await Promise.all(
        Array.from(serviceMapUpdates.entries()).map(async ([source, targets]) => {
          await mongo.collections.serviceMap.updateOne(
            { source },
            {
              $set: {
                source,
                dependencies: Array.from(targets),
                lastUpdated: now,
                lastActivity: now,
                status: 'running'
              },
            },
            { upsert: true }
          );
        })
      );

      // Emit update event
      ServiceMap.getInstance().emit(ServiceMap.UPDATE_EVENT, serviceMapUpdates);

      // Broadcast update via WebSocket if handler is set
      if (ServiceMap.wsHandler) {
        ServiceMap.wsHandler.broadcastUpdate(serviceMapUpdates);
      }
    }
  }

  /**
   * Get the current service map from MongoDB
   */
  static async getServiceMap(): Promise<ServiceMapResponse> {
    try {
      const serviceMapEntries = await mongo.collections.serviceMap.find({}).toArray() as WithId<ServiceMapEntry>[];

      // Return empty service map if no entries found
      if (!serviceMapEntries || serviceMapEntries.length === 0) {
        return {
          services: [],
          relationships: []
        };
      }

      const now = Date.now();

      // Update service status based on last activity
      await Promise.all(
        serviceMapEntries.map(async (entry) => {
          const isInactive = now - entry.lastActivity > ServiceMap.INACTIVE_THRESHOLD;
          if (isInactive && entry.status === 'running') {
            await mongo.collections.serviceMap.updateOne(
              { _id: entry._id },
              { $set: { status: 'inactive' } }
            );
            entry.status = 'inactive';
          }
        })
      );

      // Collect all unique services
      const services = new Map<string, {
        status: 'running' | 'inactive',
        lastActivity: number,
        endpoints: Map<string, {
          health: EndpointHealth,
          dependencies: Map<string, Map<string, EndpointDependency>>
        }>
      }>();

      serviceMapEntries.forEach((entry) => {
        if (!entry.source) return; // Skip entries without a source

        services.set(entry.source, {
          status: entry.status || 'inactive',
          lastActivity: entry.lastActivity || 0,
          endpoints: new Map()
        });

        // Process endpoints and their dependencies
        if (entry.endpoints) {
          // Convert plain object to Map if needed
          const endpointsMap = entry.endpoints instanceof Map
            ? entry.endpoints
            : new Map(Object.entries(entry.endpoints as Record<string, EndpointHealth>));

          endpointsMap.forEach((health: EndpointHealth, endpointName: string) => {
            if (!health) return; // Skip invalid health data

            // Convert endpointDependencies to Map if needed
            const dependencies = entry.endpointDependencies instanceof Map
              ? entry.endpointDependencies.get(endpointName) || []
              : Object.values(entry.endpointDependencies?.[endpointName] || {}) as EndpointDependency[];

            const dependencyMap = new Map<string, Map<string, EndpointDependency>>();

            dependencies.forEach((dep: EndpointDependency) => {
              if (!dep || !dep.targetService || !dep.targetEndpoint) return; // Skip invalid dependencies

              if (!dependencyMap.has(dep.targetService)) {
                dependencyMap.set(dep.targetService, new Map());
              }
              dependencyMap.get(dep.targetService)?.set(dep.targetEndpoint, dep);
            });

            services.get(entry.source)?.endpoints.set(endpointName, {
              health,
              dependencies: dependencyMap
            });
          });
        }

        // Add dependencies that haven't been seen
        if (entry.dependencies) {
          entry.dependencies.forEach((dep) => {
            if (dep && !services.has(dep)) {
              services.set(dep, {
                status: 'inactive',
                lastActivity: 0,
                endpoints: new Map()
              });
            }
          });
        }
      });

      return {
        services: Array.from(services.entries()).map(([name, info]) => ({
          name,
          status: info.status,
          lastActivity: info.lastActivity,
          endpoints: Array.from(info.endpoints.entries()).map(([endpointName, endpointInfo]) => ({
            name: endpointName,
            availability: endpointInfo.health.totalRequests > 0
              ? (endpointInfo.health.successfulRequests / endpointInfo.health.totalRequests) * 100
              : 100,
            totalRequests: endpointInfo.health.totalRequests,
            successfulRequests: endpointInfo.health.successfulRequests,
            failedRequests: endpointInfo.health.failedRequests,
            dependencies: Array.from(endpointInfo.dependencies.entries()).flatMap(([targetService, targetEndpoints]) =>
              Array.from(targetEndpoints.entries()).map(([targetEndpoint, dep]) => ({
                targetService,
                targetEndpoint,
                availability: dep.totalRequests > 0
                  ? (dep.successfulRequests / dep.totalRequests) * 100
                  : 100,
                totalRequests: dep.totalRequests,
                successfulRequests: dep.successfulRequests,
                failedRequests: dep.failedRequests
              }))
            )
          }))
        })),
        relationships: serviceMapEntries.map((entry) => ({
          source: entry.source,
          dependencies: entry.dependencies || []
        }))
      };
    } catch (error) {
      console.error('Error getting service map:', error);
      return {
        services: [],
        relationships: []
      };
    }
  }

  /**
   * Subscribe to service map updates
   */
  static onUpdate(callback: (updates: Map<string, Set<string>>) => void): void {
    ServiceMap.getInstance().on(ServiceMap.UPDATE_EVENT, callback);
  }
}
