'use strict';

const ConditionRegistry = require('./ConditionRegistry');
const ActionRegistry = require('./ActionRegistry');
const timeCondition = require('./conditions/timeCondition');
const { temperatureCondition, humidityCondition } = require('./conditions/numericStateCondition');
const { deviceStateCondition, motionCondition, doorCondition } = require('./conditions/deviceStateCondition');
const sunCondition = require('./conditions/sunCondition');
const { andCondition, orCondition } = require('./conditions/groupCondition');
const createCommandAction = require('./actions/commandAction');
const createSceneAction = require('./actions/sceneAction');

/**
 * The one place that lists every built-in condition and action type. To add
 * a new kind, write its evaluator/executor file and add one `register` line.
 *
 * @param {{deviceService?: object, sceneService?: object}} [deps] Injected
 *   services the actions need. `deviceService` is only used when a command
 *   action executes (and by a scene action to re-verify unconfirmed steps);
 *   `sceneService` when a scene action validates/executes.
 * @returns {{conditionRegistry: ConditionRegistry, actionRegistry: ActionRegistry}}
 */
function createDefaultRegistries({ deviceService, sceneService } = {}) {
  const conditionRegistry = new ConditionRegistry()
    .register(timeCondition)
    .register(temperatureCondition)
    .register(humidityCondition)
    .register(deviceStateCondition)
    .register(motionCondition)
    .register(doorCondition)
    .register(sunCondition)
    .register(andCondition)
    .register(orCondition);

  const actionRegistry = new ActionRegistry()
    .register(createCommandAction({ deviceService }))
    .register(createSceneAction({ sceneService, deviceService }));

  return { conditionRegistry, actionRegistry };
}

module.exports = createDefaultRegistries;
