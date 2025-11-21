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
import { AnnotateTechDocsEntityProcessor } from './AnnotateTechDocsEntityProcessor';

describe('AnnotateTechDocsEntityProcessor', () => {
  const processor = new AnnotateTechDocsEntityProcessor();

  it('should return the processor name', () => {
    expect(processor.getProcessorName()).toBe(
      'AnnotateTechDocsEntityProcessor',
    );
  });

  it('should add annotation if backstage.io/techdocs-ref exists', async () => {
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'test',
        annotations: {
          'backstage.io/techdocs-ref': 'dir:.',
        },
      },
    };

    const result = await processor.preProcessEntity(entity);
    expect(result.metadata.annotations).toEqual({
      'backstage.io/techdocs-ref': 'dir:.',
      'backstage.io/techdocs-exists': 'true',
    });
  });

  it('should add annotation if backstage.io/techdocs-entity exists', async () => {
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'test',
        annotations: {
          'backstage.io/techdocs-entity': 'component:default/other',
        },
      },
    };

    const result = await processor.preProcessEntity(entity);
    expect(result.metadata.annotations).toEqual({
      'backstage.io/techdocs-entity': 'component:default/other',
      'backstage.io/techdocs-exists': 'true',
    });
  });

  it('should not add annotation if neither exists', async () => {
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'test',
        annotations: {
          'other-annotation': 'value',
        },
      },
    };

    const result = await processor.preProcessEntity(entity);
    expect(result.metadata.annotations).toEqual({
      'other-annotation': 'value',
    });
  });
});
