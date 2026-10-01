import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PromocionesService } from '../../core/services/promociones.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Canje, Recompensa } from '../../core/models/modelos';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

@Component({
  selector: 'app-puntos',
  imports: [
    RouterLink,
    RouterLinkActive,
    CargandoComponent,
    VacioComponent,
    ConfirmarComponent,
  ],
  templateUrl: './puntos.component.html',
  styleUrl: './puntos.component.scss',
})
export class PuntosComponent implements OnInit {
  private readonly promociones = inject(PromocionesService);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);

  readonly exacto = { exact: true };

  readonly recompensas = signal<Recompensa[]>([]);
  readonly canjes = signal<Canje[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly confirmando = signal(false);
  readonly canjeando = signal(false);
  readonly elegida = signal<Recompensa | null>(null);

  readonly puntos = computed(() => this.auth.perfil()?.puntos ?? 0);

  readonly proxima = computed(() => {
    const disponibles = this.puntos();

    return (
      [...this.recompensas()]
        .sort((a, b) => a.costo_puntos - b.costo_puntos)
        .find((recompensa) => recompensa.costo_puntos > disponibles) ?? null
    );
  });

  readonly faltan = computed(() => {
    const meta = this.proxima();
    return meta ? Math.max(0, meta.costo_puntos - this.puntos()) : 0;
  });

  readonly progreso = computed(() => {
    const meta = this.proxima();
    if (!meta || meta.costo_puntos <= 0) return 100;

    return Math.min(100, Math.round((this.puntos() / meta.costo_puntos) * 100));
  });

  readonly canjeables = computed(
    () => this.recompensas().filter((recompensa) => recompensa.costo_puntos <= this.puntos()).length,
  );

  readonly textoConfirmacion = computed(() => {
    const recompensa = this.elegida();
    if (!recompensa) return '';

    const restantes = Math.max(0, this.puntos() - recompensa.costo_puntos);

    return `Vas a canjear "${recompensa.nombre}" por ${this.numero(recompensa.costo_puntos)} puntos. Te van a quedar ${this.numero(restantes)} puntos y el canje no se puede deshacer.`;
  });

  private readonly formatoNumero = new Intl.NumberFormat('es-AR');

  private readonly formatoFecha = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');

    try {
      const [recompensas, canjes] = await Promise.all([
        this.promociones.recompensas(true),
        this.promociones.misCanjes(),
      ]);

      this.recompensas.set(recompensas);
      this.canjes.set(canjes);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No pudimos cargar tus puntos');
    } finally {
      this.cargando.set(false);
    }
  }

  numero(valor: number): string {
    return this.formatoNumero.format(valor);
  }

  fechaDe(canje: Canje): string {
    const momento = new Date(canje.creado_en);
    if (Number.isNaN(momento.getTime())) return '';

    return this.formatoFecha.format(momento);
  }

  alcanza(recompensa: Recompensa): boolean {
    return this.puntos() >= recompensa.costo_puntos;
  }

  pedirCanje(recompensa: Recompensa): void {
    if (!this.alcanza(recompensa)) return;

    this.elegida.set(recompensa);
    this.confirmando.set(true);
  }

  async confirmarCanje(): Promise<void> {
    const recompensa = this.elegida();
    if (!recompensa || this.canjeando()) return;

    this.canjeando.set(true);

    try {
      await this.promociones.canjear(recompensa.id);
      this.avisos.exito(`¡Canjeaste ${recompensa.nombre}!`);

      await this.auth.refrescarPerfil();
      this.canjes.set(await this.promociones.misCanjes());
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos canjear la recompensa');
    } finally {
      this.canjeando.set(false);
      this.elegida.set(null);
    }
  }
}
