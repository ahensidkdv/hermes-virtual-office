import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateAgentsTable1728374400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'agents',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'role',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: `'idle'`,
            isNullable: false,
          },
          {
            name: 'position_x',
            type: 'float',
            default: 100,
            isNullable: false,
          },
          {
            name: 'position_y',
            type: 'float',
            default: 100,
            isNullable: false,
          },
          {
            name: 'room',
            type: 'varchar',
            length: '50',
            default: `'lobby'`,
            isNullable: false,
          },
          {
            name: 'current_task_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'hermes_id',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'capabilities',
            type: 'text',
            isArray: true,
            default: `'{}'`,
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
    );

    // Create indexes
    await queryRunner.createIndex(
      'agents',
      new TableIndex({
        name: 'IDX_agents_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'agents',
      new TableIndex({
        name: 'IDX_agents_current_task_id',
        columnNames: ['current_task_id'],
      }),
    );

    await queryRunner.createIndex(
      'agents',
      new TableIndex({
        name: 'IDX_agents_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Create foreign key to tasks
    await queryRunner.createForeignKey(
      'agents',
      new TableForeignKey({
        columnNames: ['current_task_id'],
        referencedTableName: 'tasks',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('agents');
  }
}
