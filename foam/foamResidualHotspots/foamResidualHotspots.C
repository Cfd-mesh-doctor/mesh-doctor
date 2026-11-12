// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
/*---------------------------------------------------------------------------*\
  foamResidualHotspots  (OpenFOAM-14 user utility, part of Mesh Doctor)

  Where does a steady solution refuse to converge?

  Reads p and U at two consecutive iterations (-from, -to), and maps the
  per-cell change (the local "residual") normalised by its RMS over the
  mesh.  Writes:
    - log summary: RMS, max, and how concentrated the change is (share of
      the total squared change carried by the top 0.01 / 0.1 / 1 % cells);
      a few cells carrying most of it = local (often mesh) problem,
      a broad spread = flow unsteadiness;
    - [processorN/]meshDoctor/hotspots/hot.txt:
      H cell score dp dU x y z V maxNonOrtho  (top -nHot cells per rank);
    - field mdChange (score) in the -to time for ParaView.

  Only internal fields are read, so boundary-condition types do not matter.
\*---------------------------------------------------------------------------*/

#include "argList.H"
#include "Time.H"
#include "fvMesh.H"
#include "volFields.H"
#include "OFstream.H"
#include "OSspecific.H"
#include <vector>
#include <algorithm>
#include <cmath>

using namespace Foam;

template<class Type>
tmp<Field<Type>> readInternal(const fvMesh& mesh, const word& name, const word& inst)
{
    typedef typename VolField<Type>::Internal FieldType;
    FieldType fld
    (
        IOobject(name, inst, mesh, IOobject::MUST_READ, IOobject::NO_WRITE, false),
        mesh,
        dimensions::invalid,
        word("internalField")
    );
    return tmp<Field<Type>>(new Field<Type>(fld.primitiveField()));
}

int main(int argc, char *argv[])
{
    argList::addOption("from", "time", "earlier iteration (time name)");
    argList::addOption("to", "time", "later iteration (time name)");
    argList::addOption("nHot", "label", "hotspot cells written per rank (default 3000)");

    #include "setRootCaseNoFunctionObjects.H"
    #include "createTimeNoFunctionObjects.H"

    const word tFrom = args.option("from");
    const word tTo = args.option("to");
    const label nHot = args.optionLookupOrDefault<label>("nHot", 3000);

    runTime.setTime(instant(readScalar(IStringStream(tTo)())), 0);
    #include "createMeshNoChangers.H"

    const scalarField pA(readInternal<scalar>(mesh, "p", tFrom));
    const scalarField pB(readInternal<scalar>(mesh, "p", tTo));
    const vectorField UA(readInternal<vector>(mesh, "U", tFrom));
    const vectorField UB(readInternal<vector>(mesh, "U", tTo));

    const label nC = mesh.nCells();
    scalarField dp(mag(pB - pA)), dU(mag(UB - UA));

    // RMS over the whole mesh (cell count weighted, like a residual norm)
    scalar s2p = sum(sqr(dp)), s2U = sum(sqr(dU));
    reduce(s2p, sumOp<scalar>()); reduce(s2U, sumOp<scalar>());
    const label nG = returnReduce(nC, sumOp<label>());
    const scalar rmsP = std::sqrt(s2p/max(nG, label(1))) + vSmall;
    const scalar rmsU = std::sqrt(s2U/max(nG, label(1))) + vSmall;

    scalarField score(nC);
    forAll(score, c) score[c] = max(dp[c]/rmsP, dU[c]/rmsU);

    // concentration: share of total squared score in the top fractions
    // (global threshold found by bisection on the score)
    auto shareAbove = [&](scalar frac, scalar& thr)
    {
        scalar lo = 0, hi = returnReduce(max(score), maxOp<scalar>());
        const label want = max(label(1), label(frac*nG));
        for (int it = 0; it < 60; it++)
        {
            const scalar mid = 0.5*(lo + hi);
            label n = 0;
            forAll(score, c) if (score[c] > mid) n++;
            reduce(n, sumOp<label>());
            if (n > want) lo = mid; else hi = mid;
        }
        thr = hi;
        scalar sTop = 0, sAll = 0;
        forAll(score, c)
        {
            sAll += sqr(score[c]);
            if (score[c] > thr) sTop += sqr(score[c]);
        }
        reduce(sTop, sumOp<scalar>()); reduce(sAll, sumOp<scalar>());
        return sTop/max(sAll, vSmall);
    };

    scalar thr1, thr2, thr3;
    const scalar sh1 = shareAbove(1e-4, thr1);
    const scalar sh2 = shareAbove(1e-3, thr2);
    const scalar sh3 = shareAbove(1e-2, thr3);

    // per-cell worst non-orthogonality (internal faces)
    const vectorField& C = mesh.cellCentres();
    const vectorField& Sf = mesh.faceAreas();
    const labelList& own = mesh.faceOwner();
    const labelList& nei = mesh.faceNeighbour();
    scalarField cNO(nC, 0);
    forAll(nei, f)
    {
        const vector d = C[nei[f]] - C[own[f]];
        const scalar cs = (d & Sf[f])/(mag(d)*mag(Sf[f]) + rootVSmall);
        const scalar ang = radToDeg(std::acos(min(max(cs, scalar(-1)), scalar(1))));
        cNO[own[f]] = max(cNO[own[f]], ang);
        cNO[nei[f]] = max(cNO[nei[f]], ang);
    }

    Info<< nl << "Change between iterations " << tFrom << " -> " << tTo << nl
        << "  cells " << nG << nl
        << "  rms |dp| " << rmsP << "  max " << returnReduce(max(dp), maxOp<scalar>()) << nl
        << "  rms |dU| " << rmsU << "  max " << returnReduce(max(dU), maxOp<scalar>()) << nl
        << "  share of total squared change in top 0.01% cells " << sh1
        << "  (score > " << thr1 << ")" << nl
        << "  share in top 0.1% " << sh2 << "  (score > " << thr2 << ")" << nl
        << "  share in top 1% " << sh3 << "  (score > " << thr3 << ")" << nl << endl;

    // top cells per rank
    std::vector<label> idx(nC);
    for (label c = 0; c < nC; c++) idx[c] = c;
    const label k = min(nHot, nC);
    std::partial_sort(idx.begin(), idx.begin() + k, idx.end(),
        [&](label a, label b){ return score[a] > score[b]; });

    const fileName outDir = runTime.path()/"meshDoctor"/"hotspots";
    mkDir(outDir);
    {
        OFstream os(outDir/"hot.txt");
        os.precision(9);
        for (label i = 0; i < k; i++)
        {
            const label c = idx[i];
            os  << "H " << c << ' ' << score[c] << ' ' << dp[c]/rmsP << ' ' << dU[c]/rmsU << ' '
                << C[c].x() << ' ' << C[c].y() << ' ' << C[c].z() << ' '
                << mesh.V()[c] << ' ' << cNO[c] << nl;
        }
    }
    if (Pstream::master())
    {
        mkDir(runTime.globalPath()/"meshDoctor");
        OFstream os(runTime.globalPath()/"meshDoctor"/"hotspots_summary.txt");
        os  << "from " << tFrom << nl << "to " << tTo << nl << "nCells " << nG << nl
            << "rmsDp " << rmsP << nl << "rmsDU " << rmsU << nl
            << "shareTop0.01pct " << sh1 << nl << "shareTop0.1pct " << sh2 << nl
            << "shareTop1pct " << sh3 << nl
            << "thrTop0.01pct " << thr1 << nl << "thrTop0.1pct " << thr2 << nl
            << "thrTop1pct " << thr3 << nl;
    }

    volScalarField::Internal out
    (
        IOobject("mdChange", tTo, mesh, IOobject::NO_READ, IOobject::NO_WRITE, false),
        mesh,
        dimensionedScalar(dimless, 0)
    );
    out.primitiveFieldRef() = score;
    out.write();

    Info<< "End" << nl << endl;
    return 0;
}
