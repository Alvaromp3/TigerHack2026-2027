# Qué hacer en cada pestaña

Fecha: 26 de septiembre de 2026.

La unidad de trabajo es la **tarea logística**: ubicación, estado, responsable, prioridad y dependencias. Cada pestaña muestra la parte que le toca a su usuario. Una acción tiene un solo resultado: mapa, capacidad, pendientes e informes leen el mismo estado.

- **P0** cierra un flujo completo y se puede enseñar.
- **P1** mejora la coordinación.
- **P2** depende de historial, integraciones o reglas avanzadas.

P0 es importante para el producto. No todo cabe en el hackathon. La demo mínima está al final.

## Live Map

Entender qué hay en una ubicación y abrir o crear la tarea de esa habitación.

**Ahora (P0)**

- Filtros de cama: disponible, pendiente de limpieza, reservada, fuera de servicio. Mostrar los filtros activos y un botón para limpiarlos.
- Al seleccionar una habitación: estado, responsable, tareas pendientes y el bloqueo principal.
- Desde la habitación, crear limpieza, transporte o incidencia con el mismo flujo que la pestaña correspondiente.
- Mostrar cuándo se actualizó el mapa y si los datos son de simulación.
- El mapa ocupa el área principal. La barra de encima lleva planta, unidad, capa, filtros y «Ajustar vista».
- Leyenda de estados de cama, aparte de ascensor, escaleras y baños.
- La selección es un contorno, no un cambio del color de estado.
- El panel derecho abre con lo útil (`MED-204 · pendiente de limpieza · tarea asignada`). La foto del interior queda plegable.

**Subpestañas de la habitación**

- Overview: cama, preparación, equipo, responsable y tareas. Una acción principal abajo.
- Patients: episodio, ubicación, destino pedido y qué bloquea el traslado. Lo clínico, plegado.
- History: historial de la habitación o del paciente, con autor, hora, estado anterior y estado nuevo.

**Después**

- P1: capas de camas, personas, equipos y tareas por separado. Localizar una tarea resaltando origen y destino. Recorridos solo si hay pasillos reales.
- P2: animar personas ligadas a una tarea.

**Listo cuando:** desde una habitación pendiente de limpieza se abre su tarea, se completa en Bed turnover y el estado nuevo se ve en el mapa y en Capacity.

## Overview

Decidir dónde intervenir primero.

**Ahora (P0)**

- Cola de atención: bloqueo, motivo, antigüedad, responsable y acceso a la acción.
- Cuatro indicadores: camas utilizables, traslados pendientes, limpiezas pendientes, tareas sin asignar. Cada cifra abre exactamente esos elementos.
- Decir si el alcance es hospital, planta o unidad, y de qué turno.
- «Limpiezas pendientes» abre Bed turnover con el mismo filtro. Staffing abre Staff. Alerts abre Incidents. El extracto de flujo abre Patient Flow.
- La acción cotidiana es «Crear solicitud» o «Ver pendientes». «Declare surge» solo si hay una emergencia activa.
- Quitar curvas decorativas. Usar una tabla de plantas y bloqueos.
- Reservar el rojo para lo que pide acción.

**Después**

- P1: historial real de indicadores, o el texto «Sin historial suficiente». Resumen de turno para el relevo.
- P2: anticipación de demanda, con los supuestos a la vista.

**Listo cuando:** una tarea completada deja de contar como pendiente en todas las vistas.

## Capacity

Ver qué se puede usar ahora, qué está bloqueado y qué trabajo lo devolvería.

**Ahora (P0)**

- Separar disponible, reservada, ocupada, pendiente de preparación y fuera de servicio.
- Mostrar la causa: limpieza, falta de personal, equipo o mantenimiento. Una cama puede tener varias.
- Reservar sin que dos solicitudes se queden la misma cama.
- «Disponibles para asignar» solo cuenta camas que cumplen los requisitos. Una cama vacía no es utilizable por defecto.
- En la tabla: bloqueo principal y «Abrir pendientes».
- Barras con estados que no se solapan y leyenda completa.
- Un porcentaje alto es una señal de presión, no una orden de desvío.

**Después**

- P1: cuándo se espera recuperar una cama, si hay datos. Equipos que limitan una unidad. Abrir espacios extra solo con sus requisitos, responsable y motivo.
- P2: escenarios de «qué pasa si libero estas habitaciones».

**Listo cuando:** una cama limpia pero fuera de servicio no sale como utilizable. Reservar baja lo libre y no sube la ocupación. El ingreso confirmado es lo que la deja ocupada.

## Patient Flow

Coordinar movimientos y explicar por qué una solicitud sigue abierta.

**Ahora (P0)**

- Dos vistas: **Pendientes** y **Actividad**. El registro actual es la actividad.
- Crear y listar solicitudes: paciente, origen, destino, prioridad y hora.
- Separar la espera: aceptación, cama, preparación o transporte. Mostrar qué impide el siguiente paso.
- Asignar transporte y quién confirma la recepción.
- Identificar por paciente y episodio, no solo por nombre.
- Al confirmar la llegada, actualizar origen, destino y la tarea de preparación del origen.
- Columnas: paciente/episodio, origen, destino, estado, espera, responsable, acción.
- Ruta legible: `F1 · ED-03 → F2 · MED-204`, con enlace al mapa.
- Prioridad y retraso son datos distintos.
- Dejar buscar, pausar y reanudar a la vista. Si la vista está pausada, decir que el hospital sigue actualizándose.
- Avisos descriptivos («Aumento de eventos que requieren revisión»), sin deducir una emergencia solo por el ritmo.

**Después**

- P1: historial más allá de las últimas 40 líneas. Aviso de retraso con regla y destinatario. Guardar quién marcó un aviso como visto, distinto de resuelto.
- P2: agrupar trayectos compatibles.

**Listo cuando:** una solicitud sin cama muestra el bloqueo, reserva un destino cuando existe y deja historial al confirmar la llegada. El origen genera preparación si hace falta.

## Bed turnover

Devolver una habitación a usable después de una salida.

**Ahora (P0)**

- Una salida que pide preparación crea una sola tarea.
- Estados: pendiente, asignada, en curso, completada. Bloqueo y cancelación son estados propios.
- Asignar a una persona o equipo habilitado.
- Mostrar si falta ropa, material, equipo o mantenimiento.
- Completar la limpieza no libera la cama si queda otro requisito.
- Tablero y tabla con los mismos filtros: por asignar, asignadas, en curso, completadas del turno.
- Cada tarjeta: habitación, planta, antigüedad, responsable y la dependencia principal.
- Acción según el estado: Asignar, Iniciar, Registrar bloqueo, Completar. El mismo paso existe como botón si se arrastra.
- Violeta para preparación. Rojo solo si hay un bloqueo que pide intervención.

**Después**

- P1: checklist por tipo de espacio. Orden por antigüedad, solicitud vinculada y prioridad. Medir espera, ejecución y duración por separado.
- P2: proponer un recorrido de tareas cercanas.

**Listo cuando:** completar registra responsable y tiempos, actualiza la habitación y quita el pendiente. Si falta ropa, la habitación sigue bloqueada y se ve la causa.

## Staff

Saber quién está, qué tiene encima y quién puede hacer cada tarea.

**Ahora (P0)**

- Un solo roster: turno, rol, unidad y disponibilidad.
- Tareas activas y pendientes por persona o equipo.
- Al asignar, filtrar por habilitación y decir por qué alguien no vale.
- Asignar y reasignar dejando constancia de quién cambió la tarea.
- Tabla: persona/equipo, rol, unidad, estado, tarea activa, pendientes, fin de turno.
- Estados con texto: En pausa, Ocupado, Disponible, Fuera de turno. Si no se sabe, poner «desconocido», no «disponible».
- Panel lateral con habilitaciones y las tareas.
- No convertir el número de tareas en una puntuación de carga. Mostrar tipo, cantidad y antigüedad.

**Después**

- P1: descansos, fin de turno y traspaso de tareas. Cobertura por unidad con la fórmula a la vista. Vista «Mi trabajo» para aceptar, iniciar y completar.
- P2: propuestas de reparto.

**Listo cuando:** solo se asigna a quien la regla permite. La asignación se ve en Staff, en la pestaña de la tarea y en el historial.

## Incidents

Problemas que paran el hospital: ascensor, habitación fuera de servicio, falta de material o una llegada extraordinaria.

**Ahora (P0)**

- Crear incidencias con tipo, ubicación, descripción, prioridad y responsable.
- Ciclo: nueva, reconocida, en curso, resuelta, cerrada.
- Vincular habitaciones, equipos y tareas afectadas. Ese bloqueo se ve en Capacity y en el mapa.
- Crear tareas de respuesta y mostrar lo que queda.
- Lista: prioridad, título, ubicación, alcance, responsable, antigüedad.
- Filtros: abiertas, sin asignar, unidad, categoría, cerradas.
- Detalle con impacto, tareas y línea temporal.
- La campana lista avisos reales y abre el objeto.
- Visto, responsable asignado y resuelto son tres cosas distintas.
- Una emergencia es una franja, no toda la app en rojo.

**Después**

- P1: llegadas previstas dentro del mismo sistema. Comentarios y escalados. Agrupar avisos del mismo problema.
- P2: proponer incidencias a partir de señales, con descarte de falsos positivos.

**Listo cuando:** una avería deja esa cama fuera de lo utilizable. Resolverla quita solo ese bloqueo. No borra una limpieza pendiente.

## Reports

Ver dónde se va el tiempo, con números que salen de lo registrado.

**Ahora (P0)**

- Resumen de turno: creado, completado y pendiente, por tipo y unidad.
- Cada indicador muestra período, fuente y fórmula.
- Barra de período, turno, unidad y exportación.
- Tres o cuatro cifras, luego causas de demora y una tabla que llega hasta la tarea.
- Si no hay datos, «Datos insuficientes». Nada de curvas de adorno.
- No contar como cero un tiempo que todavía no terminó.

**Después**

- P1: espera, ejecución y total por separado. Bloqueos agrupados por limpieza, transporte, aceptación, equipo o mantenimiento. Descargar el informe. Lista de relevo.
- P2: comparar períodos equivalentes.

**Métricas cuando exista historial**

- Espera para asignación: asignación menos creación.
- Ejecución de limpieza: fin menos inicio.
- Preparación total: requisitos cumplidos menos el momento en que quedó pendiente.
- Traslado total: llegada confirmada menos creación de la solicitud.
- Pendiente al cierre: tareas no terminadas, incluidas las heredadas.
- Bloqueo por causa: intervalos registrados, diciendo cómo se cuenta el solapamiento.

**Listo cuando:** dos personas con los mismos filtros ven el mismo número y pueden abrir las tareas que lo componen.

## Settings

Preferencias de cada persona, distintas de la configuración del hospital.

**Ahora (P0)**

- Preferencias: idioma, sonido, densidad, sección inicial y alcance habitual. Solo afectan a esa persona.
- Demo: pausar el motor, cambiar la velocidad y reiniciar solo el escenario. No mezclarlo con las preferencias del día.
- Estado de conexión y errores por servicio, en lenguaje claro.
- No mostrar interruptores que todavía no hacen nada.
- Decir si un cambio se guarda solo o pide «Guardar».

**Después**

- P1: nombres, plantas y requisitos de cada espacio. Permisos de consultar, asignar, cerrar y administrar, comprobados en el servidor. Plazos de aviso. Autor y fecha de cada cambio de regla.
- P2: integraciones, sin enseñar credenciales.

**Listo cuando:** el sonido es personal. Una regla compartida exige permiso y queda registrada. Reiniciar la demo no toca datos de otro entorno.

## Lo que todavía no es una pestaña

Encajarlo como tipos de tarea antes de abrir pantallas nuevas. Una pestaña Recursos tiene sentido cuando equipos y suministros tengan bastante por sí solos. El stock y los equipos reutilizables no comparten estados.

| Área | Dónde entra primero | Mínimo |
| --- | --- | --- |
| Transporte de pacientes | Patient Flow y Staff | Solicitud, origen, destino, responsable, recepción |
| Transporte de materiales | Tareas y Staff | Recogida, entrega, confirmación |
| Ropa | Bed turnover | Pedir ropa y confirmar la entrega |
| Equipos móviles | Capacity y Live Map | Ubicación, estado, reserva |
| Almacén | Tareas de suministro | Pedido, preparación, entrega, faltantes |
| Mantenimiento | Incidents | Avería, recurso, reparación |
| Esterilización | Tareas de apoyo | Pedido, preparación, disponibilidad |

## Demo

Historia: un traslado espera destino. Hay una habitación vacía que todavía hay que preparar. Se asigna, se completa, se reserva y se confirma el traslado.

1. Overview: se ve el pendiente y el bloqueo.
2. Capacity o Live Map: la habitación existe y pide preparación.
3. Bed turnover y Staff: hay una tarea y una persona.
4. Bed turnover: se completa y queda registrada.
5. Patient Flow: se reserva el destino y se confirma la llegada.
6. Overview o Reports: el pendiente desaparece y hay tiempos.

Para esa pasada bastan un tipo de preparación y un tipo de transporte. Ropa, mantenimiento y la llegada masiva van después de que este recorrido funcione.
