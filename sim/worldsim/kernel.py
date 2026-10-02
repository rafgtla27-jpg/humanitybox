"""
WORLD_SIM — Simulation Kernel V0.1

Volontairement minuscule. Trois responsabilités seulement :
  1. Le temps (années BP, négatif = passé : -120000 = il y a 120 000 ans)
  2. L'ordonnancement multi-échelle (chaque processus a sa propre période)
  3. Le hasard déterministe et le journal causal

Règle : un processus lit l'état, écrit l'état, et journalise ce qu'il a fait.
Il n'appelle jamais directement un autre processus.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import numpy as np


class RngStreams:
    """Un flux aléatoire indépendant par processus.

    Ajouter un nouveau processus ne modifie PAS les tirages des autres :
    un même seed reste comparable d'une version du moteur à l'autre.
    """

    def __init__(self, seed: int):
        self.seed = seed
        self._root = np.random.SeedSequence(seed)
        self._streams: dict[str, np.random.Generator] = {}

    def get(self, name: str) -> np.random.Generator:
        if name not in self._streams:
            # Le flux dépend du nom du processus, pas de l'ordre de création
            key = [ord(c) for c in name]
            ss = np.random.SeedSequence(entropy=self._root.entropy, spawn_key=key)
            self._streams[name] = np.random.Generator(np.random.PCG64(ss))
        return self._streams[name]


@dataclass
class Event:
    year: int
    kind: str
    where: str
    data: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        details = ", ".join(f"{k}={v}" for k, v in self.data.items())
        return f"[{-self.year:>7,} BP] {self.kind:<16} {self.where:<22} {details}"


class EventLog:
    def __init__(self):
        self.events: list[Event] = []

    def emit(self, year: int, kind: str, where: str, **data: Any) -> None:
        self.events.append(Event(year, kind, where, data))

    def of_kind(self, kind: str) -> list[Event]:
        return [e for e in self.events if e.kind == kind]


class Process(Protocol):
    name: str
    period: int  # en années

    def step(self, sim: "Simulation", year: int, dt: int) -> None: ...


class Simulation:
    """Scheduler multi-échelle.

    Le pas de base est le PGCD implicite des périodes : on avance au plus
    petit pas, et chaque processus ne s'exécute que lorsque son horloge tombe.
    Ordre d'exécution à une même date = ordre d'enregistrement (forçages
    physiques d'abord, réponses humaines ensuite).
    """

    def __init__(self, start_year: int, end_year: int, base_dt: int, seed: int):
        assert end_year > start_year
        self.start_year = start_year
        self.end_year = end_year
        self.base_dt = base_dt
        self.year = start_year
        self.rng = RngStreams(seed)
        self.log = EventLog()
        self.state: dict[str, Any] = {}
        self.processes: list[Process] = []
        self.observers: list[tuple[int, Callable[["Simulation", int], None]]] = []

    def add(self, process: Process) -> None:
        assert process.period % self.base_dt == 0, f"{process.name}: période non multiple du pas"
        self.processes.append(process)

    def observe(self, period: int, fn: Callable[["Simulation", int], None]) -> None:
        self.observers.append((period, fn))

    def run(self, progress: bool = False) -> None:
        while self.year < self.end_year:
            elapsed = self.year - self.start_year
            for p in self.processes:
                if elapsed % p.period == 0:
                    p.step(self, self.year, p.period)
            for period, fn in self.observers:
                if elapsed % period == 0:
                    fn(self, self.year)
            self.year += self.base_dt
            if progress and elapsed % 10_000 == 0:
                print(f"  {-self.year:>8,} BP")
        for _, fn in self.observers:
            fn(self, self.year)
