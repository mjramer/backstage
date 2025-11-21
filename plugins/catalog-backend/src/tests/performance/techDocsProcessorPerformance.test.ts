/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  TestDatabases,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import {
  DeferredEntity,
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { createDeferred } from '@backstage/types';
import { Knex } from 'knex';
import { default as catalogPlugin } from '../..';
import { applyDatabaseMigrations } from '../../database/migrations';
import { AnnotateTechDocsEntityProcessor } from '../../processors';
import {
  SyntheticLoadEvents,
  SyntheticLoadOptions,
  common,
} from './lib/catalogModuleSyntheticLoadEntities';
import { describePerformanceTest, performanceTraceEnabled } from './lib/env';

jest.setTimeout(600_000);

const traceLog: typeof console.log = performanceTraceEnabled
  ? console.log
  : () => {};

class Tracker {
  private insertBaseEntitiesStart: number | undefined;
  private insertBaseEntitiesEnd: number | undefined;
  private readonly deferred = createDeferred();

  private readonly knex: Knex;
  private readonly load: SyntheticLoadOptions;

  constructor(knex: Knex, load: SyntheticLoadOptions) {
    this.knex = knex;
    this.load = load;
  }

  events(): SyntheticLoadEvents {
    return {
      onBeforeInsertBaseEntities: () => {
        this.insertBaseEntitiesStart = Date.now();
        traceLog(`Inserting ${this.load.baseEntitiesCount} base entities`);
      },
      onAfterInsertBaseEntities: async () => {
        this.insertBaseEntitiesEnd = Date.now();

        const insertDuration = (
          (this.insertBaseEntitiesEnd - this.insertBaseEntitiesStart!) /
          1000
        ).toFixed(1);
        traceLog(
          `Inserted ${this.load.baseEntitiesCount} base entities in ${insertDuration} seconds`,
        );

        await this.completionPolling();

        const processingDuration = (
          (Date.now() - this.insertBaseEntitiesEnd) /
          1000
        ).toFixed(1);
        traceLog(
          `Processed ${this.load.baseEntitiesCount} entities in ${processingDuration} seconds`,
        );

        this.deferred.resolve();
      },
      onError: error => {
        this.deferred.reject(error);
      },
    };
  }

  async completion(): Promise<void> {
    return this.deferred;
  }

  private completionPolling() {
    const { baseEntitiesCount, childrenCount } = this.load;
    const expectedTotal = baseEntitiesCount + baseEntitiesCount * childrenCount;

    let processedTotal = 0;
    let stitchedTotal = 0;

    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const processedCount = await this.knex('refresh_state')
            .count({ count: '*' })
            .whereNotNull('processed_entity')
            .then(rows => Number(rows[0].count));

          const stitchedCount = await this.knex('final_entities')
            .count({ count: '*' })
            .whereNotNull('final_entity')
            .then(rows => Number(rows[0].count));

          const processedDelta = processedCount - processedTotal;
          const processedPercent = (
            (processedCount / expectedTotal) *
            100
          ).toFixed(1);
          const stitchedDelta = stitchedCount - stitchedTotal;
          const stitchedPercent = (
            (stitchedCount / expectedTotal) *
            100
          ).toFixed(1);

          const processedSummary = `${processedCount} (${processedPercent}%, ${processedDelta}/s)`;
          const stitchedSummary = `${stitchedCount} (${stitchedPercent}%, ${stitchedDelta}/s)`;
          traceLog(
            `Processed: ${processedSummary}\nStitched:  ${stitchedSummary}`,
          );

          processedTotal = processedCount;
          stitchedTotal = stitchedCount;

          if (stitchedCount === expectedTotal) {
            clearInterval(interval);
            resolve();
          }
        } catch (error) {
          clearInterval(interval);
          reject(error);
        }
      }, 1000);
    });
  }
}

class TechDocsLoadEntitiesProvider implements EntityProvider {
  private readonly load: SyntheticLoadOptions;
  private readonly events: SyntheticLoadEvents;

  constructor(load: SyntheticLoadOptions, events: SyntheticLoadEvents) {
    this.load = load;
    this.events = events;
  }

  getProviderName(): string {
    return 'TechDocsLoadEntitiesProvider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    setImmediate(async () => {
      try {
        this.events.onBeforeInsertBaseEntities?.();

        const deferred: DeferredEntity[] = [];
        for (let index = 0; index < this.load.baseEntitiesCount; ++index) {
          const entity = common.baseEntity(index);
          // Add TechDocs annotation to every entity to force the processor to work
          entity.metadata.annotations = {
            ...entity.metadata.annotations,
            'backstage.io/techdocs-ref': 'dir:.',
          };
          deferred.push({ entity });
        }

        await connection.applyMutation({
          type: 'full',
          entities: deferred,
        });

        this.events.onAfterInsertBaseEntities?.();
      } catch (error) {
        this.events.onError?.(error);
      }
    });
  }
}

describePerformanceTest('techDocsProcessorPerformance', () => {
  const databases = TestDatabases.create({
    ids: ['SQLITE_3'], // Use SQLite for faster local testing, or POSTGRES if available
  });

  const load: SyntheticLoadOptions = {
    baseEntitiesCount: 1000,
    baseRelationsCount: 0,
    baseRelationsSkew: 0,
    childrenCount: 0, // Keep it simple to focus on the processor overhead
  };

  it.each(databases.eachSupportedId())(
    'runs with AnnotateTechDocsEntityProcessor, %p',
    async databaseId => {
      const knex = await databases.init(databaseId);
      await applyDatabaseMigrations(knex);

      const config = {
        backend: { baseUrl: 'http://localhost:7007' },
      };

      const tracker = new Tracker(knex, load);

      const backend = await startTestBackend({
        features: [
          catalogPlugin,
          mockServices.rootConfig.factory({ data: config }),
          mockServices.database.factory({ knex }),
          createBackendModule({
            pluginId: 'catalog',
            moduleId: 'synthetic-load-entities',
            register(reg) {
              reg.registerInit({
                deps: {
                  catalog: catalogProcessingExtensionPoint,
                },
                async init({ catalog }) {
                  catalog.addEntityProvider(
                    new TechDocsLoadEntitiesProvider(load, tracker.events()),
                  );
                  // Add the processor we are testing
                  catalog.addProcessor(new AnnotateTechDocsEntityProcessor());
                },
              });
            },
          }),
        ],
      });

      await expect(tracker.completion()).resolves.toBeUndefined();
      await backend.stop();
      await knex.destroy();
    },
  );

  it.each(databases.eachSupportedId())(
    'runs WITHOUT AnnotateTechDocsEntityProcessor, %p',
    async databaseId => {
      const knex = await databases.init(databaseId);
      await applyDatabaseMigrations(knex);

      const config = {
        backend: { baseUrl: 'http://localhost:7007' },
      };

      const tracker = new Tracker(knex, load);

      const backend = await startTestBackend({
        features: [
          catalogPlugin,
          mockServices.rootConfig.factory({ data: config }),
          mockServices.database.factory({ knex }),
          createBackendModule({
            pluginId: 'catalog',
            moduleId: 'synthetic-load-entities',
            register(reg) {
              reg.registerInit({
                deps: {
                  catalog: catalogProcessingExtensionPoint,
                },
                async init({ catalog }) {
                  catalog.addEntityProvider(
                    new TechDocsLoadEntitiesProvider(load, tracker.events()),
                  );
                  // Do NOT add the processor
                },
              });
            },
          }),
        ],
      });

      await expect(tracker.completion()).resolves.toBeUndefined();
      await backend.stop();
      await knex.destroy();
    },
  );
});
