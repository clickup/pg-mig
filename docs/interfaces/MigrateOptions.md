[@clickup/pg-mig](../README.md) / [Exports](../modules.md) / MigrateOptions

# Interface: MigrateOptions

Options for the migrate() function.

## Properties

### migDir

• **migDir**: `string`

The directory the migration versions are loaded from.

#### Defined in

[src/cli.ts:27](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L27)

___

### hosts

• **hosts**: `string`[]

List of PostgreSQL master hostnames. The migration versions in `migDir`
will be applied to all of them.

#### Defined in

[src/cli.ts:30](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L30)

___

### port

• **port**: `number`

PostgreSQL port on each hosts.

#### Defined in

[src/cli.ts:32](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L32)

___

### user

• **user**: `string`

PostgreSQL user on each host.

#### Defined in

[src/cli.ts:34](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L34)

___

### pass

• **pass**: `string`

PostgreSQL password on each host.

#### Defined in

[src/cli.ts:36](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L36)

___

### db

• **db**: `string`

PostgreSQL database name on each host.

#### Defined in

[src/cli.ts:38](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L38)

___

### parallelism

• `Optional` **parallelism**: `number`

How many schemas to process in parallel (defaults to 10).

#### Defined in

[src/cli.ts:40](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L40)

___

### dry

• `Optional` **dry**: `boolean`

If true, prints what it plans to do, but doesn't change anything.

#### Defined in

[src/cli.ts:42](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L42)

___

### ci

• `Optional` **ci**: `boolean`

If true, then doesn't use log-update and doesn't replace lines; instead,
prints logs to stdout line by line.

#### Defined in

[src/cli.ts:45](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L45)

___

### action

• **action**: \{ `type`: ``"make"`` ; `name`: `string`  } \| \{ `type`: ``"list"``  } \| \{ `type`: ``"undo"`` ; `version`: `string`  } \| \{ `type`: ``"apply"``  }

What to do.

#### Defined in

[src/cli.ts:47](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L47)
