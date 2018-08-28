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

import { cloneDeep, defaultsDeep } from 'lodash';
import { createUiSettingsApi } from './ui_settings_api';

export class UiSettingsClient {
  constructor(options) {
    const {
      defaults,
      initialSettings,
      notify,
      api = createUiSettingsApi(),
    } = options;

    this._defaults = cloneDeep(defaults);
    this._cache = defaultsDeep({}, this._defaults, cloneDeep(initialSettings));
    this._api = api;
    this._notify = notify;
    this._updateObservers = new Set();
  }

  getAll() {
    return cloneDeep(this._cache);
  }

  get(key, defaultValue) {
    if (!this.isDeclared(key)) {
      // the key is not a declared setting
      // pass through the caller's desired default value
      // without persisting anything in the config document
      if (defaultValue !== undefined) {
        return defaultValue;
      }

      throw new Error(
        `Unexpected \`config.get("${key}")\` call on unrecognized configuration setting "${key}".
Setting an initial value via \`config.set("${key}", value)\` before attempting to retrieve
any custom setting value for "${key}" may fix this issue.
You can use \`config.get("${key}", defaultValue)\`, which will just return
\`defaultValue\` when the key is unrecognized.`
      );
    }

    const {
      userValue,
      value: definedDefault,
      type
    } = this._cache[key];

    let currentValue;

    if (this.isDefault(key)) {
      // honor the second parameter if it was passed
      currentValue = defaultValue === undefined ? definedDefault : defaultValue;
    } else {
      currentValue = userValue;
    }

    if (type === 'json') {
      return JSON.parse(currentValue);
    } else if (type === 'number') {
      return parseFloat(currentValue);
    }

    return currentValue;
  }

  async set(key, val) {
    return await this._update(key, val);
  }

  async remove(key) {
    return await this._update(key, null);
  }

  isDeclared(key) {
    return Boolean(key in this._cache);
  }

  isDefault(key) {
    return !this.isDeclared(key) || this._cache[key].userValue == null;
  }

  isCustom(key) {
    return this.isDeclared(key) && !('value' in this._cache[key]);
  }

  isOverridden(key) {
    return this.isDeclared(key) && Boolean(this._cache[key].isOverridden);
  }

  assertUpdateAllowed(key) {
    if (this.isOverridden(key)) {
      throw new Error(`Unable to update "${key}" because its value is overridden by the Kibana server`);
    }
  }

  overrideLocalDefault(key, newDefault) {
    // capture the previous value
    const prevDefault = this._defaults[key]
      ? this._defaults[key].value
      : undefined;

    // update defaults map
    this._defaults[key] = {
      ...this._defaults[key] || {},
      value: newDefault
    };

    // update cached default value
    this._cache[key] = {
      ...this._cache[key] || {},
      value: newDefault
    };

    // don't broadcast change if userValue was already overriding the default
    if (this._cache[key].userValue == null) {
      this._broadcastUpdate(key, newDefault, prevDefault);
    }
  }

  subscribe(observer) {
    this._updateObservers.add(observer);

    return {
      unsubscribe: () => {
        this._updateObservers.delete(observer);
      }
    };
  }

  async _update(key, value) {
    this.assertUpdateAllowed(key);

    const declared = this.isDeclared(key);
    const defaults = this._defaults;

    const oldVal = declared ? this._cache[key].userValue : undefined;
    const newVal = key in defaults && defaults[key].defaultValue === value
      ? null
      : value;

    const unchanged = oldVal === newVal;
    if (unchanged) {
      return true;
    }

    const initialVal = declared ? this.get(key) : undefined;
    this._setLocally(key, newVal);

    try {
      const { settings } = await this._api.batchSet(key, newVal);
      this._cache = defaultsDeep({}, defaults, settings);
      return true;
    } catch (error) {
      this._setLocally(key, initialVal);
      this._notify.error(error);
      return false;
    }
  }

  _setLocally(key, newValue) {
    this.assertUpdateAllowed(key);

    if (!this.isDeclared(key)) {
      this._cache[key] = {};
    }

    const oldValue = this.get(key);

    if (newValue === null) {
      delete this._cache[key].userValue;
    } else {
      const { type } = this._cache[key];
      if (type === 'json' && typeof newValue !== 'string') {
        this._cache[key].userValue = JSON.stringify(newValue);
      } else {
        this._cache[key].userValue = newValue;
      }
    }

    this._broadcastUpdate(key, newValue, oldValue);
  }

  _broadcastUpdate(key, newValue, oldValue) {
    for (const observer of this._updateObservers) {
      observer({ key, newValue, oldValue });
    }
  }
}
