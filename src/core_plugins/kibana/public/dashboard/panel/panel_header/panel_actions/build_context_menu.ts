/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { EuiContextMenuPanelDescriptor, EuiContextMenuPanelItemDescriptor } from '@elastic/eui';
import _ from 'lodash';
import { DashboardContextMenuPanel, DashboardPanelAction } from 'ui/dashboard_panel_actions';
import { ContainerState, Embeddable } from 'ui/embeddable';
import { PanelId } from '../../../selectors';

/**
 * Loops through allActions and extracts those that belong on the given contextMenuPanelId
 * @param {string} contextMenuPanelId
 * @param {Array.<DashboardPanelAction>} allActions
 */
function getActionsForPanel(contextMenuPanelId: PanelId, allActions: DashboardPanelAction[]) {
  return allActions.filter(action => action.parentPanelId === contextMenuPanelId);
}

/**
 * @param {String} contextMenuPanelId
 * @param {Array.<DashboardPanelAction>} actions
 * @param {Embeddable} embeddable
 * @param {ContainerState} containerState
 * @return {{
 *   Array.<EuiContextMenuPanelItemDescriptor> items - panel actions converted into the items expected to be on an
 *     EuiContextMenuPanel,
 *   Array.<EuiContextMenuPanelDescriptor> childPanels - extracted child panels, if any actions also open a panel. They
 *     need to be moved to the top level for EUI.
 *  }}
 */
function buildEuiContextMenuPanelItemsAndChildPanels({
  contextMenuPanelId,
  actions,
  embeddable,
  containerState,
}: {
  contextMenuPanelId: PanelId;
  actions: DashboardPanelAction[];
  embeddable?: Embeddable;
  containerState: ContainerState;
}) {
  const items: EuiContextMenuPanelItemDescriptor[] = [];
  const childPanels: EuiContextMenuPanelDescriptor[] = [];
  const actionsForPanel = getActionsForPanel(contextMenuPanelId, actions);
  actionsForPanel.forEach(action => {
    const isVisible = action.isVisible({ embeddable, containerState });
    if (!isVisible) {
      return;
    }

    if (action.childContextMenuPanel) {
      childPanels.push(
        ...buildEuiContextMenuPanels({
          contextMenuPanel: action.childContextMenuPanel,
          actions,
          embeddable,
          containerState,
        })
      );
    }

    items.push(
      convertPanelActionToContextMenuItem({
        action,
        containerState,
        embeddable,
      })
    );
  });

  return { items, childPanels };
}

/**
 * Transforms a DashboardContextMenuPanel to the shape EuiContextMenuPanel expects, inserting any registered pluggable
 * panel actions.
 * @param {DashboardContextMenuPanel} contextMenuPanel
 * @param {Array.<DashboardPanelAction>} actions to build the context menu with
 * @param {Embeddable} embeddable
 * @param {ContainerState} containerState
 * @return {EuiContextMenuPanelDescriptor[]} An array of context menu panels to be used in the eui react component.
 */
export function buildEuiContextMenuPanels({
  contextMenuPanel,
  actions,
  embeddable,
  containerState,
}: {
  contextMenuPanel: DashboardContextMenuPanel;
  actions: DashboardPanelAction[];
  embeddable?: Embeddable;
  containerState: ContainerState;
}): EuiContextMenuPanelDescriptor[] {
  const euiContextMenuPanel: EuiContextMenuPanelDescriptor = {
    id: contextMenuPanel.id,
    title: contextMenuPanel.title,
    items: [],
    content: contextMenuPanel.getContent({ embeddable, containerState }),
  };
  const contextMenuPanels = [euiContextMenuPanel];

  const { items, childPanels } = buildEuiContextMenuPanelItemsAndChildPanels({
    contextMenuPanelId: contextMenuPanel.id,
    actions,
    embeddable,
    containerState,
  });

  euiContextMenuPanel.items = items;
  return contextMenuPanels.concat(childPanels);
}

/**
 *
 * @param {DashboardPanelAction} action
 * @param {ContainerState} containerState
 * @param {Embeddable} embeddable
 * @return {EuiContextMenuPanelItemDescriptor}
 */
function convertPanelActionToContextMenuItem({
  action,
  containerState,
  embeddable,
}: {
  action: DashboardPanelAction;
  containerState: ContainerState;
  embeddable?: Embeddable;
}): EuiContextMenuPanelItemDescriptor {
  return {
    name: action.displayName,
    icon: action.icon,
    panel: _.get(action, 'childContextMenuPanel.id'),
    onClick: () => action.onClick({ embeddable, containerState }),
    disabled: action.isDisabled({ embeddable, containerState }),
    'data-test-subj': `dashboardPanelAction-${action.id}`,
  };
}
