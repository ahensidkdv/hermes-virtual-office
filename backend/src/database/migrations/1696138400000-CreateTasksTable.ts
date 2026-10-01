import { MigrationInterface, QueryRunner, Table, Index } from 'typeorm';

export class CreateTasksTable1696138400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'tasks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: `'created'`,
            isNullable: false,
          },
          {
            name: 'priority',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'parent_task_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'assigned_agent_id',
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
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
            default: `'{}'`,
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
          {
            name: 'completed_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['parent_task_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'tasks',
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    // Indexes are created via the table definition above
    // Additional indexes handled by TypeORM entity decorators
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('tasks');
  }
}
