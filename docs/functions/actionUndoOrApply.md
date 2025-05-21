[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / actionUndoOrApply

# Function: actionUndoOrApply()

> **actionUndoOrApply**(`options`, `hostDests`, `registry`): `Promise`\<\{ `success`: `boolean`; `hasMoreWork`: `boolean`; \}\>

Defined in: [src/actions/actionUndoOrApply.ts:27](https://github.com/clickup/pg-mig/blob/master/src/actions/actionUndoOrApply.ts#L27)

Applies or undoes migrations.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`MigrateOptions`](../interfaces/MigrateOptions.md) |
| `hostDests` | `Dest`[] |
| `registry` | `Registry` |

## Returns

`Promise`\<\{ `success`: `boolean`; `hasMoreWork`: `boolean`; \}\>
