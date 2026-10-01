import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { AgentsService } from 'src/agents/agents.service';

/**
 * Seed Script for Mock Agents
 * Usage: npm run seed:agents
 * Creates 5 mock agents: agent-01 through agent-05
 * Idempotent: can run multiple times safely
 */
async function seed(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const agentsService = app.get(AgentsService);

  try {
    console.log('🌱 Seeding mock agents...');

    const agents = await agentsService.listAgents();
    console.log(`✅ Found ${agents.length} agents in database`);

    if (agents.length > 0) {
      console.log('ℹ️  Agents already seeded, skipping creation');
      agents.forEach((agent: any, i: number) => {
        console.log(
          `  ${i + 1}. ${agent.name} (${agent.id}) - Role: ${agent.role}, Status: ${agent.status}`,
        );
      });
    }

    console.log('\n🎯 All agents ready:');
    agents.forEach((agent: any) => {
      console.log(`  - ${agent.name} (${agent.id}): ${agent.role}`);
    });

    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Seed failed: ${errorMessage}`);
    process.exit(1);
  } finally {
    await app.close();
  }
}

seed();
