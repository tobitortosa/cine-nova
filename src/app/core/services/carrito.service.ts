import { Injectable, computed, signal } from '@angular/core';
import { Butaca, Funcion, ItemCarrito } from '../models/modelos';

const CLAVE_CARRITO = 'cinenova_carrito';

@Injectable({ providedIn: 'root' })
export class CarritoService {
  readonly funcion = signal<Funcion | null>(null);
  readonly butacas = signal<Butaca[]>([]);
  readonly items = signal<ItemCarrito[]>(this.leerGuardados());

  readonly totalEntradas = computed(() =>
    this.butacas().reduce((suma, butaca) => suma + this.precioDe(butaca), 0),
  );

  readonly totalProductos = computed(() =>
    this.items().reduce((suma, item) => suma + item.precio_unitario * item.cantidad, 0),
  );

  readonly subtotal = computed(() => this.totalEntradas() + this.totalProductos());

  readonly cantidadProductos = computed(() =>
    this.items().reduce((suma, item) => suma + item.cantidad, 0),
  );

  setFuncion(f: Funcion | null): void {
    if (this.funcion()?.id !== f?.id) {
      this.butacas.set([]);
    }
    this.funcion.set(f);
  }

  alternarButaca(b: Butaca): void {
    this.butacas.update((lista) =>
      lista.some((butaca) => butaca.id === b.id)
        ? lista.filter((butaca) => butaca.id !== b.id)
        : [...lista, b],
    );
  }

  estaSeleccionada(id: number): boolean {
    return this.butacas().some((butaca) => butaca.id === id);
  }

  limpiarButacas(): void {
    this.butacas.set([]);
  }

  agregarProducto(item: ItemCarrito): void {
    this.items.update((lista) => {
      const indice = lista.findIndex(
        (fila) => fila.producto_id === item.producto_id && fila.combo_id === item.combo_id,
      );

      if (indice === -1) {
        return [...lista, { ...item }];
      }

      return lista.map((fila, i) =>
        i === indice ? { ...fila, cantidad: fila.cantidad + item.cantidad } : fila,
      );
    });
    this.guardar();
  }

  quitarProducto(indice: number): void {
    this.items.update((lista) => lista.filter((_, i) => i !== indice));
    this.guardar();
  }

  cambiarCantidad(indice: number, cantidad: number): void {
    if (cantidad < 1) {
      this.quitarProducto(indice);
      return;
    }

    this.items.update((lista) =>
      lista.map((fila, i) => (i === indice ? { ...fila, cantidad } : fila)),
    );
    this.guardar();
  }

  limpiar(): void {
    this.funcion.set(null);
    this.butacas.set([]);
    this.items.set([]);
    try {
      localStorage.removeItem(CLAVE_CARRITO);
    } catch {
      return;
    }
  }

  precioDe(b: Butaca): number {
    const f = this.funcion();
    if (!f) {
      return 0;
    }
    return b.tipo === 'vip' ? f.precio_vip : f.precio_base;
  }

  private guardar(): void {
    try {
      localStorage.setItem(CLAVE_CARRITO, JSON.stringify(this.items()));
    } catch {
      return;
    }
  }

  private leerGuardados(): ItemCarrito[] {
    try {
      const crudo = localStorage.getItem(CLAVE_CARRITO);
      if (!crudo) {
        return [];
      }
      const guardados = JSON.parse(crudo);
      return Array.isArray(guardados) ? (guardados as ItemCarrito[]) : [];
    } catch {
      return [];
    }
  }
}
