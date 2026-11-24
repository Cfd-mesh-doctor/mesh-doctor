// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
/*---------------------------------------------------------------------------*\
  foamCourantCells  (OpenFOAM-14 user utility, part of Mesh Doctor)

  Which cells would set the time step of a transient run?

  Reads the face flux phi (and U, if there) at -time and gives each cell its
  Courant number per second of time step, rate = 0.5*sum_f |phi_f| / V (1/s).
  With adjustTimeStep, the largest rate sets the time step: dt = maxCo/rate.
  Nothing is written into the case's time folders.  Writes
  [processorN/]meshDoctor/courant/cells.txt:
    L LO BIN             the histogram's first bin edge (log10) and bin width
    N nCells             cells of this rank
    Z count              cells with no flux at all
    W count              cells within 2x of the largest rate of the whole mesh
    B bin count          histogram of log10(rate): bins of BIN from LO (non-empty only)
    T cell rate x y z V aspectRatio maxNonOrtho magU wallDist wallPatch
                         the -nTop fastest cells of this rank; aspectRatio as checkMesh
                         (largest over smallest summed |face area| component); wallDist
                         and wallPatch: the nearest wall face on this rank (-1 none)

  Only phi's values and the internal U are used, so boundary-condition types
  do not matter.
\*---------------------------------------------------------------------------*/

#include "argList.H"
#include "Time.H"
#include "fvMesh.H"
#include "volFields.H"
#include "surfaceFields.H"
#include "wallPolyPatch.H"
#include "OFstream.H"
#include "OSspecific.H"
#include <vector>
#include <algorithm>
#include <cmath>

using namespace Foam;

static const scalar LO = -4;        // log10 of the smallest binned rate
static const scalar BIN = 0.02;     // bin width in decades (each bin 4.7 % wide, 10^0.02)
static const label NBIN = 700;      // up to 1e10 1/s

int main(int argc, char *argv[])
{
    argList::addOption("time", "time", "result time (time name) with phi");
    argList::addOption("nTop", "label", "fastest cells written per rank (default 200)");

    #include "setRootCaseNoFunctionObjects.H"
    #include "createTimeNoFunctionObjects.H"

    const word tT = args.option("time");
    const label nTop = args.optionLookupOrDefault<label>("nTop", 200);

    runTime.setTime(instant(readScalar(IStringStream(tT)())), 0);
    #include "createMeshNoChangers.H"

    const surfaceScalarField phi
    (
        IOobject("phi", tT, mesh, IOobject::MUST_READ, IOobject::NO_WRITE, false),
        mesh
    );

    const label nC = mesh.nCells();
    const labelList& own = mesh.faceOwner();
    const labelList& nei = mesh.faceNeighbour();
    const vectorField& Sf = mesh.faceAreas();
    const vectorField& C = mesh.cellCentres();
    const scalarField& V = mesh.V();

    // sum |phi| and the component sums of |Sf| per cell; worst non-orthogonality
    scalarField sumPhi(nC, 0), cNO(nC, 0);
    vectorField sumSf(nC, Zero);
    forAll(own, f)
    {
        sumSf[own[f]] += cmptMag(Sf[f]);
    }
    forAll(nei, f)
    {
        const scalar a = mag(phi[f]);
        sumPhi[own[f]] += a;
        sumPhi[nei[f]] += a;
        sumSf[nei[f]] += cmptMag(Sf[f]);
        const vector d = C[nei[f]] - C[own[f]];
        const scalar cs = (d & Sf[f])/(mag(d)*mag(Sf[f]) + rootVSmall);
        const scalar ang = radToDeg(std::acos(min(max(cs, scalar(-1)), scalar(1))));
        cNO[own[f]] = max(cNO[own[f]], ang);
        cNO[nei[f]] = max(cNO[nei[f]], ang);
    }
    forAll(mesh.boundary(), pi)
    {
        const fvPatch& p = mesh.boundary()[pi];
        const labelUList& fc = p.faceCells();
        const scalarField& pphi = phi.boundaryField()[pi];
        forAll(fc, i)
        {
            sumPhi[fc[i]] += mag(pphi[i]);
        }
        if (p.coupled())                       // processor faces: the neighbour is across
        {
            const vectorField d(p.delta());
            const vectorField& pSf = p.Sf();
            forAll(fc, i)
            {
                const scalar cs = (d[i] & pSf[i])/(mag(d[i])*mag(pSf[i]) + rootVSmall);
                cNO[fc[i]] = max(cNO[fc[i]], radToDeg(std::acos(min(max(cs, scalar(-1)), scalar(1)))));
            }
        }
    }

    scalarField rate(nC, 0);
    forAll(rate, c)
    {
        rate[c] = 0.5*sumPhi[c]/max(V[c], vSmall);
    }
    const scalar gMax = returnReduce(nC ? max(rate) : scalar(0), maxOp<scalar>());

    labelList hist(NBIN, 0);
    label nZero = 0, nWithin2 = 0;
    forAll(rate, c)
    {
        if (rate[c] <= 0)
        {
            nZero++;
            continue;
        }
        const label b = label(std::floor((std::log10(rate[c]) - LO)/BIN));
        hist[min(max(b, label(0)), NBIN - 1)]++;
        if (rate[c] >= 0.5*gMax) nWithin2++;
    }

    // local speed, if U was written
    scalarField magU(nC, -1);
    const fileName tDir = runTime.path()/tT;
    if (isFile(tDir/"U") || isFile(tDir/"U.gz"))
    {
        const volVectorField::Internal U
        (
            IOobject("U", tT, mesh, IOobject::MUST_READ, IOobject::NO_WRITE, false),
            mesh,
            dimensions::invalid,
            word("internalField")
        );
        magU = mag(U.primitiveField());
    }

    // the fastest cells of this rank
    std::vector<label> idx(nC);
    for (label c = 0; c < nC; c++) idx[c] = c;
    const label k = min(nTop, nC);
    std::partial_sort(idx.begin(), idx.begin() + k, idx.end(),
        [&](label a, label b){ return rate[a] > rate[b]; });

    // nearest wall face on this rank, for those cells only
    const polyBoundaryMesh& pbm = static_cast<const polyMesh&>(mesh).boundary();
    DynamicList<point> wallC;
    DynamicList<label> wallP;
    forAll(pbm, pi)
    {
        const polyPatch& pp = pbm[pi];
        if (isA<wallPolyPatch>(pp))
        {
            const vectorField::subField fC = pp.faceCentres();
            forAll(fC, i)
            {
                wallC.append(fC[i]);
                wallP.append(pi);
            }
        }
    }

    const fileName outDir = runTime.path()/"meshDoctor"/"courant";
    mkDir(outDir);
    OFstream os(outDir/"cells.txt");
    os.precision(9);
    os  << "L " << LO << ' ' << BIN << nl
        << "N " << nC << nl << "Z " << nZero << nl << "W " << nWithin2 << nl;
    forAll(hist, b)
    {
        if (hist[b]) os << "B " << b << ' ' << hist[b] << nl;
    }
    for (label i = 0; i < k; i++)
    {
        const label c = idx[i];
        scalar dBest = great;
        label pBest = -1;
        forAll(wallC, j)
        {
            const scalar d2 = magSqr(wallC[j] - C[c]);
            if (d2 < dBest)
            {
                dBest = d2;
                pBest = wallP[j];
            }
        }
        const vector& s = sumSf[c];
        const scalar aspect = cmptMax(s)/max(cmptMin(s), vSmall);
        os  << "T " << c << ' ' << rate[c] << ' '
            << C[c].x() << ' ' << C[c].y() << ' ' << C[c].z() << ' ' << V[c] << ' '
            << aspect << ' ' << cNO[c] << ' ' << magU[c] << ' '
            << (pBest < 0 ? scalar(-1) : std::sqrt(dBest)) << ' '
            << (pBest < 0 ? word("-") : pbm[pBest].name()) << nl;
    }

    Info<< nl << "Courant number per second of time step at " << tT << nl
        << "  cells " << returnReduce(nC, sumOp<label>()) << nl
        << "  largest " << gMax << " 1/s: dt = maxCo/" << gMax << nl
        << "  cells within 2x of it " << returnReduce(nWithin2, sumOp<label>()) << nl << endl;
    Info<< "End" << nl << endl;
    return 0;
}
