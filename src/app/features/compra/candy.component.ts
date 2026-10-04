import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CandyService } from '../../core/services/candy.service';
import { CarritoService, TOPE_UNIDADES } from '../../core/services/carrito.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Categoria, Combo, ItemCarrito, Producto } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { MAXIMO_BUTACAS, entradasIncluidas } from '../../shared/utils/ventas';

interface GrupoCandy {
  id: string;
  nombre: string;
  productos: Producto[];
}

@Component({
  selector: 'app-candy',
  imports: [RouterLink, PrecioPipe, CargandoComponent, VacioComponent],
  templateUrl: './candy.component.html',
  styleUrl: './candy.component.scss',
})
export class CandyComponent implements OnInit {
  private readonly candy = inject(CandyService);
  private readonly avisos = inject(NotificacionesService);
  readonly carrito = inject(CarritoService);

  readonly topeUnidades = TOPE_UNIDADES;

  readonly cargando = signal(true);
  readonly categorias = signal<Categoria[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly combos = signal<Combo[]>([]);
  readonly cantidades = signal<Record<string, number>>({});
  readonly grupoActivo = signal('');
  readonly detalleAbierto = signal(false);

  readonly grupos = computed<GrupoCandy[]>(() => {
    const lista = this.productos();
    const categorias = this.categorias();
    const armados: GrupoCandy[] = [];

    for (const categoria of categorias) {
      const dentro = lista.filter((producto) => producto.categoria_id === categoria.id);
      if (dentro.length > 0) {
        armados.push({
          id: 'categoria-' + categoria.id,
          nombre: categoria.nombre,
          productos: dentro,
        });
      }
    }

    const sueltos = lista.filter(
      (producto) =>
        producto.categoria_id === null ||
        !categorias.some((categoria) => categoria.id === producto.categoria_id),
    );

    if (sueltos.length > 0) {
      armados.push({ id: 'categoria-otros', nombre: 'Otros', productos: sueltos });
    }

    return armados;
  });

  readonly hayCatalogo = computed(() => this.combos().length > 0 || this.grupos().length > 0);

  private readonly entradasPorCombo = computed(
    () => new Map(this.combos().map((combo) => [combo.id, entradasIncluidas(combo)])),
  );

  readonly entradasEnPedido = computed(() =>
    this.carrito
      .items()
      .reduce((suma, item) => suma + item.cantidad * this.entradasPorUnidad(item), 0),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [categorias, productos, combos] = await Promise.all([
        this.candy.categorias(),
        this.candy.productos(true),
        this.candy.combos(true),
      ]);

      this.categorias.set(categorias);
      this.productos.set(productos);
      this.combos.set(combos);

      const primero = this.grupos()[0];
      if (primero) {
        this.grupoActivo.set(primero.id);
      }
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo cargar el candy bar',
      );
    } finally {
      this.cargando.set(false);
    }
  }

  claveProducto(producto: Producto): string {
    return 'producto-' + producto.id;
  }

  claveCombo(combo: Combo): string {
    return 'combo-' + combo.id;
  }

  cantidadDe(clave: string): number {
    return this.cantidades()[clave] ?? 1;
  }

  entradasDe(combo: Combo): number {
    return entradasIncluidas(combo);
  }

  puedeSumar(item: ItemCarrito): boolean {
    if (item.cantidad >= TOPE_UNIDADES) return false;
    const incluidas = this.entradasPorUnidad(item);
    return incluidas === 0 || this.entradasEnPedido() + incluidas <= MAXIMO_BUTACAS;
  }

  cambiarCantidad(clave: string, paso: number): void {
    const nueva = Math.min(TOPE_UNIDADES, Math.max(1, this.cantidadDe(clave) + paso));
    this.cantidades.update((mapa) => ({ ...mapa, [clave]: nueva }));
  }

  agregarProducto(producto: Producto): void {
    const clave = this.claveProducto(producto);

    this.sumarAlPedido(clave, {
      producto_id: producto.id,
      combo_id: null,
      nombre: producto.nombre,
      cantidad: this.cantidadDe(clave),
      precio_unitario: producto.precio,
      imagen_url: producto.imagen_url,
    });
  }

  agregarCombo(combo: Combo): void {
    const clave = this.claveCombo(combo);

    this.sumarAlPedido(
      clave,
      {
        producto_id: null,
        combo_id: combo.id,
        nombre: combo.nombre,
        cantidad: this.cantidadDe(clave),
        precio_unitario: combo.precio,
        imagen_url: combo.imagen_url,
      },
      entradasIncluidas(combo),
    );
  }

  ajustarDelCarrito(indice: number, paso: number): void {
    const actual = this.carrito.items()[indice];
    if (!actual || (paso > 0 && !this.puedeSumar(actual))) {
      return;
    }
    this.carrito.cambiarCantidad(indice, Math.min(TOPE_UNIDADES, actual.cantidad + paso));
  }

  quitarDelCarrito(indice: number): void {
    const actual = this.carrito.items()[indice];
    if (!actual) {
      return;
    }
    this.carrito.quitarProducto(indice);
    this.avisos.info('Sacamos ' + actual.nombre + ' de tu pedido');
  }

  alternarDetalle(): void {
    this.detalleAbierto.update((abierto) => !abierto);
  }

  irACategoria(id: string): void {
    this.grupoActivo.set(id);
    const destino = document.getElementById(id);
    if (destino) {
      destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private sumarAlPedido(clave: string, item: ItemCarrito, incluidas = 0): void {
    const enPedido = this.carrito.cantidadDe(item.producto_id, item.combo_id);
    const porUnidades = TOPE_UNIDADES - enPedido;
    const porEntradas =
      incluidas > 0 ? Math.floor((MAXIMO_BUTACAS - this.entradasEnPedido()) / incluidas) : porUnidades;
    const cantidad = Math.min(item.cantidad, porUnidades, porEntradas);

    if (cantidad <= 0) {
      this.avisos.error(
        porEntradas < porUnidades
          ? `Tus combos ya incluyen ${this.entradasEnPedido()} entradas y en una compra podés elegir hasta ${MAXIMO_BUTACAS} butacas`
          : `Ya tenés ${TOPE_UNIDADES} unidades de ${item.nombre} en tu pedido, que es el máximo por producto`,
      );
      return;
    }

    this.carrito.agregarProducto({ ...item, cantidad });
    this.reiniciar(clave);

    if (cantidad < item.cantidad) {
      this.avisos.info(
        porEntradas < porUnidades
          ? `Agregamos ${cantidad} x ${item.nombre}: en una compra podés elegir hasta ${MAXIMO_BUTACAS} butacas`
          : `Agregamos ${cantidad} x ${item.nombre}: llegaste al máximo de ${TOPE_UNIDADES} unidades por producto`,
      );
      return;
    }

    this.avisos.exito('Agregamos ' + cantidad + ' x ' + item.nombre + ' a tu pedido');
  }

  private entradasPorUnidad(item: ItemCarrito): number {
    return item.combo_id !== null ? (this.entradasPorCombo().get(item.combo_id) ?? 0) : 0;
  }

  private reiniciar(clave: string): void {
    this.cantidades.update((mapa) => ({ ...mapa, [clave]: 1 }));
  }
}
