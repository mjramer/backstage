/*
 * Copyright 2020 The Backstage Authors
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

import { Entity } from '@backstage/catalog-model';
import { merge } from 'lodash';
import { CatalogProcessor } from '@backstage/plugin-catalog-node';
import {
  TECHDOCS_ANNOTATION,
  TECHDOCS_EXTERNAL_ANNOTATION,
} from '@backstage/plugin-techdocs-common';

/** @public */
export class AnnotateTechDocsEntityProcessor implements CatalogProcessor {
  getProcessorName(): string {
    return 'AnnotateTechDocsEntityProcessor';
  }

  async preProcessEntity(entity: Entity): Promise<Entity> {
    const hasTechDocs =
      Boolean(entity.metadata.annotations?.[TECHDOCS_ANNOTATION]) ||
      Boolean(entity.metadata.annotations?.[TECHDOCS_EXTERNAL_ANNOTATION]);

    if (hasTechDocs) {
      return merge(entity, {
        metadata: {
          annotations: {
            'backstage.io/techdocs-exists': 'true',
          },
        },
      });
    }

    return entity;
  }
}
