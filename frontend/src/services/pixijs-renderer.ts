import * as PIXI from 'pixi.js';
import * as TWEEN from 'tween.js';
import { Agent, RoomType } from '../types';

export interface Room {
  name: RoomType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

// Room layout with precise positioning
const ROOMS: Room[] = [
  { name: 'lobby', x: 50, y: 400, width: 150, height: 100, color: 0x4a5568 },
  { name: 'work_desk_1', x: 250, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'work_desk_2', x: 350, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'work_desk_3', x: 450, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'work_desk_4', x: 550, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'work_desk_5', x: 650, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'work_desk_6', x: 750, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'work_desk_7', x: 850, y: 400, width: 80, height: 80, color: 0x2d3748 },
  { name: 'meeting_room', x: 400, y: 150, width: 150, height: 150, color: 0x5a67d8 },
  { name: 'review_area', x: 650, y: 150, width: 150, height: 150, color: 0xed8936 }
];

export class PixiJSRenderer {
  private app: PIXI.Application | null = null;
  private stage: PIXI.Container | null = null;
  private agentSprites: Map<string, PIXI.Container> = new Map();
  private tweens: Map<string, TWEEN.Tween<{ x: number; y: number }>> = new Map();
  private animationFrameId: number | null = null;

  async init(container: HTMLElement): Promise<void> {
    this.app = new PIXI.Application({
      width: 1200,
      height: 700,
      backgroundColor: 0x1a202c,
      antialias: true,
      resolution: window.devicePixelRatio || 1
    });

    container.appendChild(this.app.canvas);
    this.stage = this.app.stage;

    this.drawOfficeLayout();
    this.startAnimationLoop();
  }

  private startAnimationLoop(): void {
    const animate = () => {
      TWEEN.update();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private drawOfficeLayout(): void {
    if (!this.stage) return;

    // Draw rooms
    for (const room of ROOMS) {
      const roomRect = new PIXI.Graphics();
      roomRect.lineStyle(2, 0x718096);
      roomRect.beginFill(room.color);
      roomRect.drawRect(0, 0, room.width, room.height);
      roomRect.endFill();

      roomRect.x = room.x;
      roomRect.y = room.y;

      // Add label
      const label = new PIXI.Text(room.name, {
        fontSize: 12,
        fill: 0xffffff,
        fontFamily: 'Arial'
      });
      label.x = 5;
      label.y = room.height - 20;
      roomRect.addChild(label);

      this.stage.addChild(roomRect);
    }
  }

  drawAgent(agent: Agent, isSelected: boolean = false): void {
    if (!this.stage) return;

    // Remove old sprite
    this.removeAgent(agent.id);

    const container = new PIXI.Container();
    container.x = agent.position_x;
    container.y = agent.position_y;

    // Avatar circle
    const circle = new PIXI.Graphics();
    const color = this.getStatusColor(agent.status);
    circle.beginFill(color);
    circle.drawCircle(0, 0, 16);
    circle.endFill();

    if (isSelected) {
      circle.lineStyle(3, 0xffd700);
      circle.drawCircle(0, 0, 16);
    }

    container.addChild(circle);

    // Name label
    const label = new PIXI.Text(agent.name, {
      fontSize: 10,
      fill: 0xffffff,
      fontFamily: 'Arial'
    });
    label.anchor.set(0.5);
    label.y = 25;
    container.addChild(label);

    // Status badge
    const badge = new PIXI.Graphics();
    badge.beginFill(color);
    badge.drawCircle(0, 0, 6);
    badge.endFill();
    badge.x = 12;
    badge.y = -12;
    container.addChild(badge);

    this.stage.addChild(container);
    this.agentSprites.set(agent.id, container);
  }

  updateAgent(agent: Agent): void {
    const sprite = this.agentSprites.get(agent.id);
    if (sprite) {
      // Update status badge color
      const badge = sprite.children[2] as PIXI.Graphics;
      if (badge) {
        const newColor = this.getStatusColor(agent.status);
        badge.clear();
        badge.beginFill(newColor);
        badge.drawCircle(0, 0, 6);
        badge.endFill();
      }
    }
  }

  animateAgent(agentId: string, toX: number, toY: number, duration: number = 2500): void {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;

    // Cancel existing tween if any
    const existingTween = this.tweens.get(agentId);
    if (existingTween) {
      existingTween.stop();
    }

    const startPos = { x: sprite.x, y: sprite.y };
    const tween = new TWEEN.Tween(startPos)
      .to({ x: toX, y: toY }, duration)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate(() => {
        sprite.x = startPos.x;
        sprite.y = startPos.y;
      })
      .onComplete(() => {
        this.tweens.delete(agentId);
      })
      .start();

    this.tweens.set(agentId, tween);
  }

  selectAgent(agentId: string): void {
    this.agentSprites.forEach((sprite, id) => {
      const circle = sprite.children[0] as PIXI.Graphics;
      if (id === agentId) {
        circle.clear();
        circle.lineStyle(3, 0xffd700);
        circle.beginFill(0x48bb78);
        circle.drawCircle(0, 0, 16);
        circle.endFill();
      } else {
        circle.clear();
        circle.beginFill(0x48bb78);
        circle.drawCircle(0, 0, 16);
        circle.endFill();
      }
    });
  }

  removeAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite && this.stage) {
      this.stage.removeChild(sprite);
      this.agentSprites.delete(agentId);
    }
  }

  private getStatusColor(status: string): number {
    switch (status) {
      case 'idle':
        return 0x4299e1; // Blue
      case 'working':
        return 0x48bb78; // Green
      case 'discussing':
        return 0xf6ad55; // Orange
      case 'blocked':
        return 0xf56565; // Red
      default:
        return 0x718096; // Gray
    }
  }

  getApp(): PIXI.Application | null {
    return this.app;
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    // Stop all tweens
    this.tweens.forEach(tween => tween.stop());
    this.tweens.clear();
    this.app?.destroy();
  }
}

export const pixiRenderer = new PixiJSRenderer();
