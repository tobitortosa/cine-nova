import { Injectable, Signal, signal } from '@angular/core';

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
}

const DURACION_MS = 4500;

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private contador = 0;
  private readonly lista = signal<Aviso[]>([]);

  readonly avisos: Signal<Aviso[]> = this.lista.asReadonly();

  exito(texto: string): void {
    this.agregar(texto, 'ok');
  }

  error(texto: string): void {
    this.agregar(texto, 'error');
  }

  info(texto: string): void {
    this.agregar(texto, 'info');
  }

  cerrar(id: number): void {
    this.lista.update((actuales) => actuales.filter((aviso) => aviso.id !== id));
  }

  private agregar(texto: string, tipo: Aviso['tipo']): void {
    const limpio = (texto ?? '').trim();
    if (!limpio) return;

    this.contador += 1;
    const id = this.contador;

    this.lista.update((actuales) => [...actuales, { id, texto: limpio, tipo }]);

    setTimeout(() => this.cerrar(id), DURACION_MS);
  }
}
