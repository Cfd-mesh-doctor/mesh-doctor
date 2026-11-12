// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
/*---------------------------------------------------------------------------*\
    foamMeshDoctor  -  OpenFOAM-14 (openfoam.org) utility

    Detect -> highlight -> correct bad cells, entirely inside the mesh.

    Detect:  every face is scored with OpenFOAM's own quality formulas
             (meshCheck::faceOrthogonality, meshCheck::faceSkewness,
             meshCheck::boundaryFaceSkewness, plus the face-weight,
             volume-ratio and face-pyramid definitions used by checkMesh /
             snappyHexMesh).  Geometry (face centres/areas, cell centres/
             volumes) is computed with the same algorithm as primitiveMesh.

    Highlight: writes the worst faces, the cells around them and nearby
             boundary faces to <case>/[processorN/]meshDoctor/ for the
             dashboard viewer.

    Correct (-fix): moves mesh points to reduce the worst local badness.
             - topology is never changed (no cells added or removed)
             - points on curved walls, feature edges, corners, patch-to-patch
               junctions and processor boundaries never move, so the geometry
               is preserved exactly
             - with -slideFlat, points on an exactly planar patch region may
               slide inside that plane (ground, symmetry, flat plates)
             - a move is accepted only if the worst face around the point
               gets better (or equal worst and smaller sum of badness^4) and
               no face pyramid or cell volume becomes invalid: the local
               worst quality can never get worse.
             Refuses to run unless <case>/.meshDoctorCopy exists, so a
             baseline case can never be modified.

    Badness of a face = max over its metrics of (value / target), e.g.
    nonOrtho/65, skew/4, 0.05/weight; >= 100 means an invalid (inverted)
    face pyramid.  A face with badness <= 1 meets every target.
\*---------------------------------------------------------------------------*/

#include "argList.H"
#include "Time.H"
#include "polyMesh.H"
#include "syncTools.H"
#include "primitiveMeshCheck.H"
#include "coupledPolyPatch.H"
#include "pointIOField.H"
#include "OFstream.H"
#include "OSspecific.H"
#include "Tuple2.H"
#include "UIndirectList.H"
#include "tetPointRef.H"
#include "faceSet.H"

#include <vector>
#include <algorithm>
#include <unordered_map>
#include <cmath>

using namespace Foam;

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

struct FaceQ
{
    scalar nonOrtho = 0;    // degrees, internal/coupled only
    scalar skew = 0;
    scalar weight = 0.5;
    scalar volRatio = 1;
    scalar minPyr = 1;      // smallest face-pyramid volume (signed, >0 good)
    scalar tetQ = 1;        // min sign-adjusted face-tet quality (checkMesh)
    label nTetFail = 0;     // failed sides, counted like checkMesh
    bool boundary = false;
};


class MeshDoctor
{
public:

    const polyMesh& mesh;
    const faceList& fs;
    const labelList& own;
    const labelList& nei;
    const label nInt;

    pointField pts;
    vectorField fC, fA, cC;
    scalarField cV;
    pointField neiCcB;
    scalarField neiVB;
    boolList coupledB;          // per boundary face
    scalarField bad;            // per face badness
    std::vector<unsigned char> vmask;  // per face violation bits
    std::vector<unsigned char> cconc;  // per cell: concave (face-plane test)
    std::vector<unsigned char> cdet;   // per cell: determinant < 0.001

    // targets
    scalar tNonOrtho, tSkew, tBSkew, tWeight, tVolRatio;
    scalar tetTol;
    scalar capFrac;
    pointField orig;
    scalarField h0;

    // movable points
    boolList movable;
    vectorField slideN;         // zero = free interior point
    boolList curved;            // slides on curved wall, re-projected
    vectorField edgeT;          // tangent of the feature edge (edge points)
    labelList eNb0, eNb1;       // neighbours along the feature edge, -1 = none
    // effective limits for "no new violation": never worse than the
    // original mesh's worst value, never looser than the target
    scalar lNonOrtho = 180, lSkew = great, lBSkew = great, lWeight = 0, lVolRatio = 0;

    MeshDoctor(const polyMesh& m)
    :
        mesh(m),
        fs(m.faces()),
        own(m.faceOwner()),
        nei(m.faceNeighbour()),
        nInt(m.nInternalFaces()),
        pts(m.points()),
        fC(m.nFaces()),
        fA(m.nFaces()),
        cC(m.nCells()),
        cV(m.nCells()),
        coupledB(m.nFaces() - m.nInternalFaces(), false),
        bad(m.nFaces(), 0.0),
        tNonOrtho(65), tSkew(4), tBSkew(20), tWeight(0.05), tVolRatio(0.01),
        tetTol(sqr(small)), capFrac(0.5), orig(m.points()), h0(m.nPoints(), -1)
    {
        forAll(m.boundary(), patchi)
        {
            const polyPatch& pp = m.boundary()[patchi];
            if (pp.coupled())
            {
                forAll(pp, i) coupledB[pp.start() + i - nInt] = true;
            }
        }
    }

    bool isCoupled(label f) const
    {
        return f >= nInt && coupledB[f - nInt];
    }

    void calcFace(label f)
    {
        const Tuple2<vector, point> ac =
            face::areaAndCentre(UIndirectList<point>(pts, fs[f]));
        fA[f] = ac.first();
        fC[f] = ac.second();
    }

    // Same algorithm as primitiveMesh::makeCellCentresAndVols
    void calcCell(label c)
    {
        const cell& cf = mesh.cells()[c];
        vector cEst = Zero;
        forAll(cf, i) cEst += fC[cf[i]];
        cEst /= cf.size();

        vector cc = Zero;
        scalar v = 0;
        forAll(cf, i)
        {
            const label f = cf[i];
            const scalar pyr3 =
                own[f] == c
              ? (fA[f] & (fC[f] - cEst))
              : (fA[f] & (cEst - fC[f]));
            cc += pyr3*((3.0/4.0)*fC[f] + (1.0/4.0)*cEst);
            v += pyr3;
        }
        cC[c] = mag(v) > vSmall ? cc/v : cEst;
        cV[c] = v/3.0;
    }

    void calcAll()
    {
        forAll(fs, f) calcFace(f);
        forAll(cC, c) calcCell(c);
        syncTools::swapBoundaryCellPositions(mesh, cC, neiCcB);
        syncTools::swapBoundaryCellList(mesh, cV, neiVB);
    }

    // Same tets as polyMeshTetDecomposition::checkFaceTets:
    // (p_i, p_i+1, faceCentre, cellCentre); owner tets must have quality
    // < -tol, neighbour tets > tol.  Returned sign-adjusted: > tol is good.
    scalar faceTetQ(label f, const point& cc, bool isOwner) const
    {
        const face& ff = fs[f];
        scalar q = vGreat;
        forAll(ff, i)
        {
            const scalar t = tetPointRef
            (
                pts[ff[i]], pts[ff.nextLabel(i)], fC[f], cc
            ).quality();
            q = min(q, isOwner ? -t : t);
        }
        return q;
    }

    // Same fan as polyMeshTetDecomposition::minQuality (base point b)
    scalar fanQuality(label f, const point& cc, bool isOwner, label b) const
    {
        const face& ff = fs[f];
        const point& base = pts[ff[b]];
        scalar q = vGreat;
        for (label t = 1; t < ff.size() - 1; t++)
        {
            const label i = (t + b) % ff.size();
            const label j = ff.fcIndex(i);
            const point& pA = isOwner ? pts[ff[i]] : pts[ff[j]];
            const point& pB = isOwner ? pts[ff[j]] : pts[ff[i]];
            q = min(q, tetPointRef(cc, base, pA, pB).quality());
        }
        return q;
    }

    // findBasePoint / findSharedBasePoint: best base, > tetTol means found
    scalar baseQuality(label f, const point& co, const point* cn) const
    {
        scalar best = -vGreat;
        forAll(fs[f], b)
        {
            scalar q = fanQuality(f, co, true, b);
            if (cn) q = min(q, fanQuality(f, *cn, false, b));
            best = max(best, q);
            if (best > tetTol) break;
        }
        return best;
    }

    // Violation bits per metric (a move may never set a new bit)
    unsigned char maskOf(const FaceQ& q) const
    {
        unsigned char m = 0;
        if (q.minPyr <= 0) m |= 1;
        if (q.nTetFail) m |= 2;
        if (!q.boundary)
        {
            if (q.nonOrtho > lNonOrtho) m |= 4;
            if (q.skew > lSkew) m |= 8;
            if (q.weight < lWeight) m |= 16;
            if (q.volRatio < lVolRatio) m |= 32;
        }
        else if (q.skew > lBSkew) m |= 64;
        return m;
    }

    FaceQ evalFace(label f) const
    {
        FaceQ q;
        const point& co = cC[own[f]];
        if (f < nInt || coupledB[f - nInt])
        {
            point cn;
            scalar vn;
            if (f < nInt) { cn = cC[nei[f]]; vn = cV[nei[f]]; }
            else { cn = neiCcB[f - nInt]; vn = neiVB[f - nInt]; }

            const scalar c = meshCheck::faceOrthogonality(co, cn, fA[f]);
            q.nonOrtho = radToDeg(::acos(min(scalar(1), max(scalar(-1), c))));
            q.skew = meshCheck::faceSkewness(mesh, pts, fC, fA, f, co, cn);
            const scalar dO = mag(fA[f] & (fC[f] - co));
            const scalar dN = mag(fA[f] & (cn - fC[f]));
            q.weight = min(dN, dO)/(dN + dO + vSmall);
            const scalar vo = cV[own[f]];
            q.volRatio = min(vo, vn)/(max(vo, vn) + vSmall);
            q.minPyr =
                min(fA[f] & (fC[f] - co), fA[f] & (cn - fC[f]))/3.0;
            const scalar qo = faceTetQ(f, co, true);
            q.tetQ = qo;
            q.nTetFail = (qo < tetTol);
            if (f < nInt)
            {
                const scalar qn = faceTetQ(f, cn, false);
                q.tetQ = min(qo, qn);
                q.nTetFail += (qn < tetTol);
            }
            const scalar qb = baseQuality(f, co, &cn);
            q.nTetFail += (qb <= tetTol);
            q.tetQ = min(q.tetQ, qb);
        }
        else
        {
            q.boundary = true;
            q.skew = meshCheck::boundaryFaceSkewness(mesh, pts, fC, fA, f, co);
            q.minPyr = (fA[f] & (fC[f] - co))/3.0;
            q.tetQ = faceTetQ(f, co, true);
            q.nTetFail = (q.tetQ < tetTol);
            const scalar qb = baseQuality(f, co, nullptr);
            q.nTetFail += (qb <= tetTol);
            q.tetQ = min(q.tetQ, qb);
        }
        return q;
    }

    scalar badness(label f, const FaceQ& q) const
    {
        if (q.minPyr <= 0)
        {
            const scalar vRef = mag(cV[own[f]]) + vSmall;
            return 100.0 + 100.0*min(scalar(1), -q.minPyr/vRef);
        }
        if (q.nTetFail)
        {
            return 50.0 + 50.0*min(scalar(1), max(scalar(0), -q.tetQ));
        }
        scalar b = 0;
        if (!q.boundary)
        {
            b = max(b, q.nonOrtho/tNonOrtho);
            b = max(b, q.skew/tSkew);
            b = max(b, tWeight/max(q.weight, scalar(1e-9)));
            b = max(b, tVolRatio/max(q.volRatio, scalar(1e-12)));
        }
        else
        {
            b = max(b, q.skew/tBSkew);
        }
        return b;
    }

    void setLimits()
    {
        scalar mxNO = 0, mxSk = 0, mxBSk = 0, mnW = 1, mnVR = 1;
        forAll(fs, f)
        {
            const FaceQ q = evalFace(f);
            if (!q.boundary)
            {
                mxNO = max(mxNO, q.nonOrtho); mxSk = max(mxSk, q.skew);
                mnW = min(mnW, q.weight); mnVR = min(mnVR, q.volRatio);
            }
            else mxBSk = max(mxBSk, q.skew);
        }
        reduce(mxNO, maxOp<scalar>()); reduce(mxSk, maxOp<scalar>());
        reduce(mxBSk, maxOp<scalar>()); reduce(mnW, minOp<scalar>());
        reduce(mnVR, minOp<scalar>());
        // within target: never let the worst value get worse than it was
        lNonOrtho = mxNO > tNonOrtho ? tNonOrtho : mxNO;
        lSkew = mxSk > tSkew ? tSkew : mxSk;
        lBSkew = mxBSk > tBSkew ? tBSkew : mxBSk;
        lWeight = mnW < tWeight ? tWeight : mnW;
        lVolRatio = mnVR < tVolRatio ? tVolRatio : mnVR;
    }

    // checkMesh concave-cell test (meshCheck::checkConcaveCells, 1e-6)
    bool concave(label c) const
    {
        const cell& cf = mesh.cells()[c];
        forAll(cf, i)
        {
            const label fi = cf[i];
            vector fN = fA[fi]/max(mag(fA[fi]), vSmall);
            if (own[fi] != c) fN = -fN;
            forAll(cf, j)
            {
                if (j == i) continue;
                vector pC = fC[cf[j]] - fC[fi];
                pC /= max(mag(pC), vSmall);
                if ((pC & fN) > -1e-6) return true;
            }
        }
        return false;
    }

    // checkMesh cell determinant (meshCheck::cellDeterminant, 3D)
    scalar cellDet(label c) const
    {
        const cell& cf = mesh.cells()[c];
        scalar avgArea = 0;
        label n = 0;
        forAll(cf, i)
        {
            const label f = cf[i];
            if (f < nInt || coupledB[f - nInt]) { avgArea += mag(fA[f]); n++; }
        }
        if (n == 0) return 0;
        avgArea /= n;
        symmTensor t(Zero);
        forAll(cf, i)
        {
            const label f = cf[i];
            if (f < nInt || coupledB[f - nInt]) t += sqr(fA[f]/avgArea);
        }
        return mag(det(t));
    }

    bool smallDet(label c) const { return cellDet(c) < 0.001; }

    void calcBadAll()
    {
        cconc.assign(mesh.nCells(), 0);
        for (label c = 0; c < mesh.nCells(); c++) cconc[c] = concave(c);
        cdet.assign(mesh.nCells(), 0);
        for (label c = 0; c < mesh.nCells(); c++) cdet[c] = smallDet(c);
        vmask.assign(fs.size(), 0);
        forAll(fs, f)
        {
            const FaceQ q = evalFace(f);
            bad[f] = badness(f, q);
            vmask[f] = maskOf(q);
        }
    }

    // ---------------------------------------------------------------------
    // Movable points

    // p lies on exactly one feature edge that runs nearly straight through
    // it, and its wall faces form at most two smooth groups (the two sides
    // of the edge).  Returns the two edge neighbours and the tangent.
    bool edgePoint(label p, scalar cosFeat, vector& t, label& a, label& b) const
    {
        const labelList& pf = mesh.pointFaces()[p];
        std::vector<std::pair<label, label>> eq;   // (other point, face)
        vector g0 = Zero, g1 = Zero;
        forAll(pf, i)
        {
            const label f = pf[i];
            if (f < nInt) continue;
            if (coupledB[f - nInt]) return false;
            const face& ff = fs[f];
            const label k = ff.which(p);
            eq.push_back({ff.prevLabel(k), f});
            eq.push_back({ff.nextLabel(k), f});
            const vector n = fA[f]/(mag(fA[f]) + vSmall);
            if (magSqr(g0) == 0) g0 = n;
            else if ((n & g0) >= cosFeat) {}
            else if (magSqr(g1) == 0) g1 = n;
            else if ((n & g1) >= cosFeat) {}
            else return false;                      // corner
        }
        if (eq.size() < 4) return false;
        std::sort(eq.begin(), eq.end());
        std::vector<label> feat;
        size_t i = 0;
        while (i < eq.size())
        {
            size_t j = i;
            while (j < eq.size() && eq[j].first == eq[i].first) j++;
            bool isFeat = true;
            if (j - i == 2)
            {
                const label f0 = eq[i].second, f1 = eq[i + 1].second;
                const vector n0 = fA[f0]/(mag(fA[f0]) + vSmall);
                const vector n1 = fA[f1]/(mag(fA[f1]) + vSmall);
                isFeat =
                    mesh.boundary().whichPatch(f0) != mesh.boundary().whichPatch(f1)
                 || (n0 & n1) < cosFeat;
            }
            if (isFeat) feat.push_back(eq[i].first);
            i = j;
        }
        if (feat.size() != 2) return false;
        a = feat[0];
        b = feat[1];
        const vector da = orig[a] - orig[p], db = orig[b] - orig[p];
        const vector ua = da/(mag(da) + vSmall), ub = db/(mag(db) + vSmall);
        if ((ua & ub) > -cosFeat) return false;     // edge bends at p
        t = ub - ua;
        t /= mag(t) + vSmall;
        return true;
    }

    void setMovable(bool slideFlat, scalar flatTolDeg, bool slideCurved, scalar featDeg, bool slideEdges = false)
    {
        const label nPts = mesh.nPoints();
        movable.setSize(nPts, true);
        slideN.setSize(nPts, Zero);
        curved.setSize(nPts, false);
        edgeT.setSize(nPts, Zero);
        eNb0.setSize(nPts, -1);
        eNb1.setSize(nPts, -1);
        const scalar cosFeat = ::cos(degToRad(featDeg));

        // Points of cells that own coupled faces: frozen (keeps processor
        // boundaries consistent without communication)
        forAll(coupledB, bi)
        {
            if (!coupledB[bi]) continue;
            const label f = bi + nInt;
            const labelList cp = mesh.cells()[own[f]].labels(fs);
            forAll(cp, i) movable[cp[i]] = false;
        }

        // Boundary points: frozen unless on an exactly planar single-patch
        // region (then they may slide in the plane)
        const scalar cosTol = ::cos(degToRad(flatTolDeg));
        const labelListList& pFaces = mesh.pointFaces();
        boolList onBoundary(nPts, false);
        for (label f = nInt; f < fs.size(); f++)
        {
            const face& ff = fs[f];
            forAll(ff, i) onBoundary[ff[i]] = true;
        }

        forAll(onBoundary, p)
        {
            if (!onBoundary[p] || !movable[p]) continue;
            if (!slideFlat) { movable[p] = false; continue; }

            label patchId = -1;
            vector n0 = Zero, nSum = Zero;
            bool onePatch = true, flat = true, coupled = false;
            const labelList& pf = pFaces[p];
            forAll(pf, i)
            {
                const label f = pf[i];
                if (f < nInt) continue;
                if (coupledB[f - nInt]) { coupled = true; onePatch = false; break; }
                const label pid = mesh.boundary().whichPatch(f);
                const vector n = fA[f]/(mag(fA[f]) + vSmall);
                nSum += fA[f];
                if (patchId == -1) { patchId = pid; n0 = n; }
                else if (pid != patchId) { onePatch = false; break; }
                else if ((n & n0) < cosTol) flat = false;
            }
            if (coupled || patchId == -1) { movable[p] = false; continue; }
            if (onePatch && flat) { slideN[p] = n0; continue; }
            if (onePatch && slideCurved)
            {
                // smooth curved wall only: no feature edge or corner here
                const vector nm = nSum/(mag(nSum) + vSmall);
                bool smooth = true;
                forAll(pf, i)
                {
                    const label f = pf[i];
                    if (f < nInt) continue;
                    if (((fA[f]/(mag(fA[f]) + vSmall)) & nm) < cosFeat) { smooth = false; break; }
                }
                if (smooth) { slideN[p] = nm; curved[p] = true; continue; }
            }
            vector t;
            label a, b;
            if (slideEdges && edgePoint(p, cosFeat, t, a, b))
            {
                edgeT[p] = t; eNb0[p] = a; eNb1[p] = b;
                continue;
            }
            movable[p] = false;
        }
    }

    // ---------------------------------------------------------------------
    // Local optimisation

    void affected(label p, std::vector<label>& faces) const
    {
        faces.clear();
        const labelList& pc = mesh.pointCells()[p];
        forAll(pc, i)
        {
            const cell& cf = mesh.cells()[pc[i]];
            forAll(cf, j) faces.push_back(cf[j]);
        }
        std::sort(faces.begin(), faces.end());
        faces.erase(std::unique(faces.begin(), faces.end()), faces.end());
    }

    void localScore
    (
        const std::vector<label>& faces,
        const scalarField& b,
        scalar& mx,
        scalar& s4
    ) const
    {
        mx = 0;
        s4 = 0;
        for (const label f : faces)
        {
            mx = max(mx, b[f]);
            if (b[f] > 1) s4 += sqr(b[f] - 1);
        }
    }

    // Try a new position; keep it if it improves the local score
    bool tryMove
    (
        label p,
        const point& newPos0,
        const std::vector<label>& faces,
        scalar& curMax,
        scalar& curS4
    )
    {
        const labelList& pf = mesh.pointFaces()[p];
        const labelList& pc = mesh.pointCells()[p];

        const point oldPos = pts[p];
        const point newPos = placed(p, newPos0);
        if (mag(newPos - orig[p]) > capFrac*h0[p]) return false;
        if (magSqr(newPos - oldPos) < sqr(1e-12*h0[p])) return false;
        std::vector<vector> oFc(pf.size()), oFa(pf.size()), oCc(pc.size());
        std::vector<scalar> oV(pc.size());
        forAll(pf, i) { oFc[i] = fC[pf[i]]; oFa[i] = fA[pf[i]]; }
        forAll(pc, i) { oCc[i] = cC[pc[i]]; oV[i] = cV[pc[i]]; }

        pts[p] = newPos;
        forAll(pf, i) calcFace(pf[i]);

        bool valid = true;
        forAll(pc, i)
        {
            calcCell(pc[i]);
            if (cV[pc[i]] <= 0 && oV[i] > 0) valid = false;
        }
        // never make a convex cell concave
        if (valid)
        {
            forAll(pc, i)
            {
                if (!cconc[pc[i]] && concave(pc[i])) { valid = false; break; }
                if (!cdet[pc[i]] && smallDet(pc[i])) { valid = false; break; }
            }
        }

        scalar nMax = 0, nS4 = 0;
        std::vector<scalar> nb;
        std::vector<unsigned char> nm;
        if (valid)
        {
            nb.resize(faces.size());
            nm.resize(faces.size());
            for (size_t k = 0; k < faces.size() && valid; k++)
            {
                const label f = faces[k];
                const FaceQ q = evalFace(f);
                nb[k] = badness(f, q);
                nm[k] = maskOf(q);
                // never create a new violation of any individual metric
                if (nm[k] & ~vmask[f]) valid = false;
                nMax = max(nMax, nb[k]);
                if (nb[k] > 1) nS4 += sqr(nb[k] - 1);
            }
        }

        const bool better =
            valid
         && nMax <= curMax*(1 + 1e-12)
         && nS4 < curS4*(1 - 1e-6);

        if (better)
        {
            for (size_t k = 0; k < faces.size(); k++)
            {
                bad[faces[k]] = nb[k];
                vmask[faces[k]] = nm[k];
            }
            forAll(pc, i)
            {
                cconc[pc[i]] = concave(pc[i]);
                cdet[pc[i]] = smallDet(pc[i]);
            }
            curMax = nMax;
            curS4 = nS4;
            return true;
        }

        pts[p] = oldPos;
        forAll(pf, i) { fC[pf[i]] = oFc[i]; fA[pf[i]] = oFa[i]; }
        forAll(pc, i) { cC[pc[i]] = oCc[i]; cV[pc[i]] = oV[i]; }
        return false;
    }

    vector constrain(label p, const vector& d) const
    {
        if (eNb0.size() && eNb0[p] >= 0) return (d & edgeT[p])*edgeT[p];
        const vector& n = slideN[p];
        if (magSqr(n) > 0) return d - (d & n)*n;
        return d;
    }

    static point closestOnTri(const point& x, const point& a, const point& b, const point& c)
    {
        const vector ab = b - a, ac = c - a, ap = x - a;
        const scalar d1 = ab & ap, d2 = ac & ap;
        if (d1 <= 0 && d2 <= 0) return a;
        const vector bp = x - b; const scalar d3 = ab & bp, d4 = ac & bp;
        if (d3 >= 0 && d4 <= d3) return b;
        const scalar vc = d1*d4 - d3*d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return a + (d1/(d1 - d3))*ab;
        const vector cp = x - c; const scalar d5 = ab & cp, d6 = ac & cp;
        if (d6 >= 0 && d5 <= d6) return c;
        const scalar vb = d5*d2 - d1*d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return a + (d2/(d2 - d6))*ac;
        const scalar va = d3*d6 - d5*d4;
        if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0)
            return b + ((d4 - d3)/((d4 - d3) + (d5 - d6)))*(c - b);
        const scalar den = 1/(va + vb + vc);
        return a + ab*(vb*den) + ac*(vc*den);
    }

    // Nearest point on the ORIGINAL wall faces around p (fan triangles
    // from the original face centres): the wall shape is kept
    point projectOrig(label p, const point& x) const
    {
        const labelList& pf = mesh.pointFaces()[p];
        point best = orig[p];
        scalar bd = great;
        forAll(pf, i)
        {
            const label f = pf[i];
            if (f < nInt) continue;
            const face& ff = fs[f];
            const point fc = face::areaAndCentre(UIndirectList<point>(orig, ff)).second();
            forAll(ff, k)
            {
                const point q = closestOnTri(x, fc, orig[ff[k]], orig[ff.nextLabel(k)]);
                const scalar d = magSqr(q - x);
                if (d < bd) { bd = d; best = q; }
            }
        }
        return best;
    }

    // Nearest point on the ORIGINAL feature-edge polyline through p
    point projectEdge(label p, const point& x) const
    {
        point best = orig[p];
        scalar bd = great;
        for (const label q : {eNb0[p], eNb1[p]})
        {
            const vector e = orig[q] - orig[p];
            const scalar s = min(max(((x - orig[p]) & e)/(magSqr(e) + vSmall), scalar(0)), scalar(1));
            const point c = orig[p] + s*e;
            if (magSqr(c - x) < bd) { bd = magSqr(c - x); best = c; }
        }
        return best;
    }

    point placed(label p, const point& x) const
    {
        if (eNb0.size() && eNb0[p] >= 0) return projectEdge(p, x);
        return curved[p] ? projectOrig(p, x) : x;
    }

    // Returns number of accepted moves
    label improvePoint(label p, std::vector<label>& faces)
    {
        affected(p, faces);
        scalar curMax, curS4;
        localScore(faces, bad, curMax, curS4);
        if (curMax <= 1.0) return 0;

        const labelList& pp = mesh.pointPoints()[p];
        scalar hMin = great;
        point lap = Zero;
        forAll(pp, i)
        {
            hMin = min(hMin, mag(pts[pp[i]] - pts[p]));
            lap += pts[pp[i]];
        }
        if (pp.empty() || hMin <= 0) return 0;
        if (h0[p] < 0)
        {
            scalar h = great;
            forAll(pp, i) h = min(h, mag(orig[pp[i]] - orig[p]));
            h0[p] = h;
        }
        lap /= pp.size();

        const labelList& pc = mesh.pointCells()[p];
        point cen = Zero;
        forAll(pc, i) cen += cC[pc[i]];
        cen /= pc.size();

        label nAcc = 0;

        // 1. smoothing targets with back-tracking
        const point targets[2] = {cen, lap};
        for (const point& t : targets)
        {
            const vector d0 = constrain(p, t - pts[p]);
            for (const scalar r : {1.0, 0.5, 0.25, 0.1})
            {
                if (tryMove(p, pts[p] + r*d0, faces, curMax, curS4))
                {
                    nAcc++;
                    break;
                }
            }
        }

        // 2. compass (pattern) search, greedy
        vector ax[3] = {vector(1,0,0), vector(0,1,0), vector(0,0,1)};
        if (eNb0[p] >= 0)
        {
            ax[0] = edgeT[p];
            ax[1] = Zero;
            ax[2] = Zero;
        }
        else if (magSqr(slideN[p]) > 0)
        {
            const vector& n = slideN[p];
            vector a = mag(n.x()) < 0.9 ? vector(1,0,0) : vector(0,1,0);
            a = a - (a & n)*n; a /= mag(a);
            ax[0] = a;
            ax[1] = n ^ a;
            ax[2] = Zero;
        }

        scalar h = 0.25*hMin;
        for (int level = 0; level < 5 && curMax > 1.0; level++)
        {
            bool moved = true;
            int guard = 0;
            while (moved && guard++ < 6 && curMax > 1.0)
            {
                moved = false;
                for (int a = 0; a < 3 && !moved; a++)
                {
                    if (magSqr(ax[a]) == 0) continue;
                    for (const scalar sgn : {1.0, -1.0})
                    {
                        if (tryMove(p, pts[p] + sgn*h*ax[a], faces, curMax, curS4))
                        {
                            nAcc++;
                            moved = true;
                            break;
                        }
                    }
                }
            }
            h *= 0.5;
        }
        return nAcc;
    }

    void optimise(label maxIter, label rings)
    {
        std::vector<label> faces;
        for (label iter = 0; iter < maxIter; iter++)
        {
            // active points: points of cells next to faces above target
            boolList active(mesh.nPoints(), false);
            label nActive = 0;
            forAll(fs, f)
            {
                if (bad[f] <= 1.0) continue;
                for (int side = 0; side < 2; side++)
                {
                    label c = side == 0 ? own[f] : (f < nInt ? nei[f] : -1);
                    if (c < 0) continue;
                    const labelList cp = mesh.cells()[c].labels(fs);
                    forAll(cp, i)
                    {
                        if (movable[cp[i]] && !active[cp[i]])
                        {
                            active[cp[i]] = true;
                            nActive++;
                        }
                    }
                }
            }
            for (label r = 0; r < rings; r++)
            {
                boolList grow(active);
                forAll(active, p)
                {
                    if (!active[p]) continue;
                    const labelList& pp = mesh.pointPoints()[p];
                    forAll(pp, i)
                    {
                        if (movable[pp[i]] && !grow[pp[i]])
                        {
                            grow[pp[i]] = true;
                            nActive++;
                        }
                    }
                }
                active.transfer(grow);
            }

            // order: worst neighbourhood first
            std::vector<std::pair<scalar, label>> order;
            order.reserve(nActive);
            forAll(active, p)
            {
                if (!active[p]) continue;
                affected(p, faces);
                scalar mx, s4;
                localScore(faces, bad, mx, s4);
                order.push_back({-mx, p});
            }
            std::sort(order.begin(), order.end());

            label nAcc = 0;
            for (const auto& o : order) nAcc += improvePoint(o.second, faces);

            scalar mxBad = 0;
            label nAbove = 0;
            forAll(bad, f)
            {
                if (isCoupled(f) && !ownerSideCoupled(f)) continue;
                mxBad = max(mxBad, bad[f]);
                if (bad[f] > 1.0) nAbove++;
            }
            const label gAcc = returnReduce(nAcc, sumOp<label>());
            Info<< "  sweep " << iter + 1
                << "  active points " << returnReduce(label(order.size()), sumOp<label>())
                << "  accepted moves " << gAcc
                << "  faces above target " << returnReduce(nAbove, sumOp<label>())
                << "  worst badness " << returnReduce(mxBad, maxOp<scalar>())
                << endl;
            if (gAcc == 0) break;
        }
    }

    bool ownerSideCoupled(label f) const
    {
        const label patchi = mesh.boundary().whichPatch(f);
        const polyPatch& pp = mesh.boundary()[patchi];
        return refCast<const coupledPolyPatch>(pp).owner();
    }

    // ---------------------------------------------------------------------
    // Summary (global, OpenFOAM-comparable)

    void summary(const fileName& file, const word& tag) const
    {
        label nNO65 = 0, nNO70 = 0, nNO90 = 0, nSk4 = 0, nBSk20 = 0;
        label nW = 0, nVR = 0, nPyr = 0, nNegV = 0, nBad = 0, nNO = 0, nTet = 0;
        scalar mxNO = 0, sumNO = 0, mxSk = 0, mxBSk = 0, mnW = 1, mnVR = 1;
        scalar mxBad = 0;
        labelList hist(18, 0);
        labelList skHist(10, 0);
        const scalar skEdges[9] = {0.5, 1, 2, 3, 4, 6, 10, 20, 50};

        forAll(fs, f)
        {
            if (isCoupled(f) && !ownerSideCoupled(f)) continue;
            const FaceQ q = evalFace(f);
            if (q.minPyr < -small) nPyr++;
            nTet += q.nTetFail;
            mxBad = max(mxBad, bad[f]);
            if (bad[f] > 1.0) nBad++;
            if (!q.boundary)
            {
                nNO++;
                sumNO += q.nonOrtho;
                mxNO = max(mxNO, q.nonOrtho);
                if (q.nonOrtho > 65) nNO65++;
                if (q.nonOrtho > 70) nNO70++;
                if (q.nonOrtho > 90) nNO90++;
                hist[min(label(q.nonOrtho/5), label(17))]++;
                mxSk = max(mxSk, q.skew);
                if (q.skew > 4) nSk4++;
                mnW = min(mnW, q.weight);
                if (q.weight < 0.05) nW++;
                mnVR = min(mnVR, q.volRatio);
                if (q.volRatio < 0.01) nVR++;
                label k = 0;
                while (k < 9 && q.skew > skEdges[k]) k++;
                skHist[k]++;
            }
            else
            {
                mxBSk = max(mxBSk, q.skew);
                if (q.skew > 4) nSk4++;     // checkMesh counts all faces
                if (q.skew > 20) nBSk20++;
            }
        }
        forAll(cV, c) if (cV[c] <= vSmall) nNegV++;
        label nConc = 0, nDet = 0;
        for (label c = 0; c < mesh.nCells(); c++)
        {
            if (concave(c)) nConc++;
            if (smallDet(c)) nDet++;
        }
        reduce(nConc, sumOp<label>());
        reduce(nDet, sumOp<label>());

        reduce(nNO65, sumOp<label>()); reduce(nNO70, sumOp<label>());
        reduce(nNO90, sumOp<label>()); reduce(nSk4, sumOp<label>());
        reduce(nBSk20, sumOp<label>()); reduce(nW, sumOp<label>());
        reduce(nVR, sumOp<label>()); reduce(nPyr, sumOp<label>());
        reduce(nNegV, sumOp<label>()); reduce(nBad, sumOp<label>());
        reduce(nTet, sumOp<label>());
        reduce(nNO, sumOp<label>()); reduce(sumNO, sumOp<scalar>());
        reduce(mxNO, maxOp<scalar>()); reduce(mxSk, maxOp<scalar>());
        reduce(mxBSk, maxOp<scalar>()); reduce(mnW, minOp<scalar>());
        reduce(mnVR, minOp<scalar>()); reduce(mxBad, maxOp<scalar>());
        forAll(hist, i) reduce(hist[i], sumOp<label>());
        forAll(skHist, i) reduce(skHist[i], sumOp<label>());
        const label nCellsG = returnReduce(mesh.nCells(), sumOp<label>());

        Info<< nl << "[" << tag << "] cells " << nCellsG
            << "  maxNonOrtho " << mxNO << "  avg " << sumNO/max(nNO, label(1))
            << "  >65: " << nNO65 << "  >70: " << nNO70
            << "  maxSkew " << max(mxSk, mxBSk) << "  skew>4: " << nSk4
            << "  wrongPyramids " << nPyr << "  badTetFaces " << nTet
            << "  badVolumes " << nNegV
            << "  minWeight " << mnW << "  minVolRatio " << mnVR
            << "  concaveCells " << nConc << "  smallDetCells " << nDet
            << "  facesAboveTarget " << nBad << "  worstBadness " << mxBad
            << nl << endl;

        if (Pstream::master())
        {
            OFstream os(file);
            os  << "tag " << tag << nl
                << "nCells " << nCellsG << nl
                << "maxNonOrtho " << mxNO << nl
                << "avgNonOrtho " << sumNO/max(nNO, label(1)) << nl
                << "nNonOrtho65 " << nNO65 << nl
                << "nNonOrtho70 " << nNO70 << nl
                << "nNonOrtho90 " << nNO90 << nl
                << "maxSkewInternal " << mxSk << nl
                << "maxSkewBoundary " << mxBSk << nl
                << "nSkew4 " << nSk4 << nl
                << "nBoundarySkew20 " << nBSk20 << nl
                << "minWeight " << mnW << nl
                << "nWeight005 " << nW << nl
                << "minVolRatio " << mnVR << nl
                << "nVolRatio001 " << nVR << nl
                << "nWrongPyramids " << nPyr << nl
                << "nBadTetFaces " << nTet << nl
                << "nBadVolumes " << nNegV << nl
                << "nConcaveCells " << nConc << nl
                << "nSmallDeterminant " << nDet << nl
                << "nFacesAboveTarget " << nBad << nl
                << "worstBadness " << mxBad << nl
                << "targets " << tNonOrtho << ' ' << tSkew << ' ' << tBSkew
                << ' ' << tWeight << ' ' << tVolRatio << nl
                << "nonOrthoHist5deg";
            forAll(hist, i) os << ' ' << hist[i];
            os  << nl << "skewHist";
            forAll(skHist, i) os << ' ' << skHist[i];
            os  << nl;
        }
    }

    // ---------------------------------------------------------------------
    // Highlight output (per processor)

    void writePoly(OFstream& os, label f) const
    {
        const face& ff = fs[f];
        os << ' ' << ff.size();
        forAll(ff, i)
        {
            const point& p = pts[ff[i]];
            os << ' ' << p.x() << ' ' << p.y() << ' ' << p.z();
        }
    }

    void writeHighlight
    (
        const fileName& dir,
        label maxBadOut,
        label maxGeom,
        scalar ctx
    ) const
    {
        mkDir(dir);
        std::vector<std::pair<scalar, label>> order;
        forAll(fs, f)
        {
            if (bad[f] > 1.0 && !(isCoupled(f) && !ownerSideCoupled(f)))
            {
                order.push_back({-bad[f], f});
            }
        }
        std::sort(order.begin(), order.end());
        if (label(order.size()) > maxBadOut) order.resize(maxBadOut);

        OFstream os(dir/"badFaces.txt");
        os.precision(9);
        os  << "# B face patch badness nonOrtho skew weight volRatio minPyrRel"
            << " cx cy cz h owner neighbour" << nl;
        std::vector<label> geomFaces;
        for (const auto& o : order)
        {
            const label f = o.second;
            const FaceQ q = evalFace(f);
            const label c = own[f];
            const scalar h = std::cbrt(mag(cV[c]) + vSmall);
            word pname = "internal";
            if (f >= nInt) pname = mesh.boundary()[mesh.boundary().whichPatch(f)].name();
            os  << "B " << f << ' ' << pname << ' ' << bad[f] << ' '
                << q.nonOrtho << ' ' << q.skew << ' ' << q.weight << ' '
                << q.volRatio << ' ' << q.minPyr/(mag(cV[c]) + vSmall) << ' '
                << fC[f].x() << ' ' << fC[f].y() << ' ' << fC[f].z() << ' '
                << h << ' ' << c << ' ' << (f < nInt ? nei[f] : -1) << nl;
            if (label(geomFaces.size()) < maxGeom) geomFaces.push_back(f);
        }

        // Cells around the worst faces, with each face's badness
        OFstream og(dir/"badCells.txt");
        og.precision(9);
        std::vector<label> cellsOut;
        for (const label f : geomFaces)
        {
            cellsOut.push_back(own[f]);
            if (f < nInt) cellsOut.push_back(nei[f]);
        }
        std::sort(cellsOut.begin(), cellsOut.end());
        cellsOut.erase(std::unique(cellsOut.begin(), cellsOut.end()), cellsOut.end());
        for (const label c : cellsOut)
        {
            const cell& cf = mesh.cells()[c];
            forAll(cf, i)
            {
                og << "F " << c << ' ' << cf[i] << ' ' << bad[cf[i]];
                writePoly(og, cf[i]);
                og << nl;
            }
        }

        // Context: boundary (non-coupled) faces near the worst faces
        if (geomFaces.empty()) return;
        scalar G = 0;
        for (const label f : geomFaces)
        {
            G = max(G, ctx*std::cbrt(mag(cV[own[f]]) + vSmall));
        }
        auto key = [G](const point& p)
        {
            const long long i = (long long)std::floor(p.x()/G);
            const long long j = (long long)std::floor(p.y()/G);
            const long long k = (long long)std::floor(p.z()/G);
            return (i*73856093LL) ^ (j*19349663LL) ^ (k*83492791LL);
        };
        std::unordered_map<long long, std::vector<label>> grid;
        for (const label f : geomFaces) grid[key(fC[f])].push_back(f);

        OFstream ow(dir/"context.txt");
        ow.precision(9);
        label nCtx = 0;
        for (label f = nInt; f < fs.size() && nCtx < 200000; f++)
        {
            if (coupledB[f - nInt]) continue;
            const point& p = fC[f];
            bool near = false;
            for (int di = -1; di <= 1 && !near; di++)
            for (int dj = -1; dj <= 1 && !near; dj++)
            for (int dk = -1; dk <= 1 && !near; dk++)
            {
                const point q(p.x() + di*G, p.y() + dj*G, p.z() + dk*G);
                auto it = grid.find(key(q));
                if (it == grid.end()) continue;
                for (const label g : it->second)
                {
                    const scalar R = ctx*std::cbrt(mag(cV[own[g]]) + vSmall);
                    if (magSqr(fC[g] - p) < R*R) { near = true; break; }
                }
            }
            if (!near) continue;
            ow  << "W " << f << ' '
                << mesh.boundary()[mesh.boundary().whichPatch(f)].name();
            writePoly(ow, f);
            ow << nl;
            nCtx++;
        }
    }
};


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

int main(int argc, char *argv[])
{
    argList::addNote
    (
        "Detect, highlight and (with -fix) correct bad mesh cells by moving "
        "points only, using OpenFOAM's own quality definitions"
    );
    argList::addBoolOption("fix", "move points to improve bad faces");
    argList::addBoolOption("slideFlat", "let points on exactly flat patches slide in-plane");
    argList::addBoolOption("dryRun", "with -fix: optimise but do not write points");
    argList::addOption("nonOrthTarget", "scalar", "degrees (default 65)");
    argList::addOption("skewTarget", "scalar", "internal skewness (default 4)");
    argList::addOption("bSkewTarget", "scalar", "boundary skewness (default 20)");
    argList::addOption("weightTarget", "scalar", "min face weight (default 0.05)");
    argList::addOption("volRatioTarget", "scalar", "min volume ratio (default 0.01)");
    argList::addOption("maxIter", "label", "optimisation sweeps (default 30)");
    argList::addOption("rings", "label", "extra point rings around bad cells (default 1)");
    argList::addOption("flatTol", "scalar", "planarity tolerance, degrees (default 0.05)");
    argList::addOption("maxBadOut", "label", "max bad faces listed per processor (default 20000)");
    argList::addOption("maxGeom", "label", "max bad faces with cell geometry (default 3000)");
    argList::addOption("context", "scalar", "context radius in cell sizes (default 6)");
    argList::addOption("tag", "word", "output tag (default before/after)");
    argList::addOption("maxDispFrac", "scalar", "max point move / local min edge (default 0.5)");
    argList::addBoolOption("slideCurved", "let points on smooth curved walls slide, re-projected onto the original wall");
    argList::addOption("tagBefore", "word", "-fix: name of the before report (default before)");
    argList::addOption("tagAfter", "word", "-fix: name of the after report (default after)");
    argList::addBoolOption("writeCollapseSet", "write faceSet mdCollapse with the faces whose pyramids are still inverted (input for collapseEdges -collapseFaceSet)");
    argList::addBoolOption("slideEdges", "let points on straight-ish feature edges slide along the edge, re-projected onto the original edge");
    argList::addOption("featureAngle", "scalar", "curved sliding only where wall normals vary less than this (default 15 deg)");

    #include "setRootCaseNoFunctionObjects.H"
    #include "createTimeNoFunctionObjects.H"
    #include "createPolyMesh.H"

    const bool fix = args.optionFound("fix");
    const fileName rootDir = args.rootPath()/args.globalCaseName();

    if (fix && !isFile(rootDir/".meshDoctorCopy"))
    {
        FatalErrorInFunction
            << "Refusing to modify " << rootDir << nl
            << "    -fix only runs on a copy made by meshdoctor.py "
            << "(marker file .meshDoctorCopy missing)" << exit(FatalError);
    }

    MeshDoctor md(mesh);
    md.tNonOrtho = args.optionLookupOrDefault<scalar>("nonOrthTarget", 65);
    md.tSkew = args.optionLookupOrDefault<scalar>("skewTarget", 4);
    md.tBSkew = args.optionLookupOrDefault<scalar>("bSkewTarget", 20);
    md.tWeight = args.optionLookupOrDefault<scalar>("weightTarget", 0.05);
    md.tVolRatio = args.optionLookupOrDefault<scalar>("volRatioTarget", 0.01);
    md.capFrac = args.optionLookupOrDefault<scalar>("maxDispFrac", 0.5);

    const label maxBadOut = args.optionLookupOrDefault<label>("maxBadOut", 20000);
    const label maxGeom = args.optionLookupOrDefault<label>("maxGeom", 3000);
    const scalar ctx = args.optionLookupOrDefault<scalar>("context", 6);

    const fileName globalOut = rootDir/"meshDoctor";
    const fileName localOut = runTime.path()/"meshDoctor";
    if (Pstream::master()) mkDir(globalOut);

    Info<< "Computing geometry and face quality" << endl;
    md.calcAll();
    md.setLimits();
    md.calcBadAll();

    const word tag0 = fix
      ? args.optionLookupOrDefault<word>("tagBefore", "before")
      : args.optionLookupOrDefault<word>("tag", "report");
    const word tag1 = args.optionLookupOrDefault<word>("tagAfter", "after");
    md.summary(globalOut/("summary_" + tag0 + ".txt"), tag0);
    md.writeHighlight(localOut/tag0, maxBadOut, maxGeom, ctx);

    if (fix)
    {
        md.setMovable
        (
            args.optionFound("slideFlat"),
            args.optionLookupOrDefault<scalar>("flatTol", 0.05),
            args.optionFound("slideCurved"),
            args.optionLookupOrDefault<scalar>("featureAngle", 15),
            args.optionFound("slideEdges")
        );
        label nMov = 0, nSlide = 0;
        forAll(md.movable, p)
        {
            if (md.movable[p]) nMov++;
            if (magSqr(md.slideN[p]) > 0) nSlide++;
        }
        label nCurv = 0;
        forAll(md.curved, p) if (md.curved[p]) nCurv++;
        Info<< "Points sliding on curved walls " << returnReduce(nCurv, sumOp<label>()) << endl;
        label nEdge = 0;
        forAll(md.eNb0, p) if (md.eNb0[p] >= 0) nEdge++;
        Info<< "Points sliding along feature edges " << returnReduce(nEdge, sumOp<label>()) << endl;
        Info<< "Movable points " << returnReduce(nMov, sumOp<label>())
            << " (of which sliding on flat patches "
            << returnReduce(nSlide, sumOp<label>()) << ")" << nl << endl;

        md.optimise
        (
            args.optionLookupOrDefault<label>("maxIter", 30),
            args.optionLookupOrDefault<label>("rings", 1)
        );

        // Fresh, from-scratch recomputation for the verdict
        md.calcAll();
        md.calcBadAll();
        md.summary(globalOut/("summary_" + tag1 + ".txt"), tag1);
        {
            scalar dev = 0;
            forAll(md.curved, p)
            {
                if (md.curved[p]) dev = max(dev, mag(md.projectOrig(p, md.pts[p]) - md.pts[p]));
            }
            Info<< "Max distance of moved wall points from the original wall "
                << returnReduce(dev, maxOp<scalar>()) << " m" << endl;
            scalar devE = 0, maxSlide = 0;
            forAll(md.eNb0, p)
            {
                if (md.eNb0[p] < 0) continue;
                devE = max(devE, mag(md.projectEdge(p, md.pts[p]) - md.pts[p]));
                maxSlide = max(maxSlide, mag(md.pts[p] - md.orig[p]));
            }
            Info<< "Max distance of edge points from the original edge "
                << returnReduce(devE, maxOp<scalar>()) << " m (max slide "
                << returnReduce(maxSlide, maxOp<scalar>()) << " m)" << endl;
        }
        md.writeHighlight(localOut/tag1, maxBadOut, maxGeom, ctx);

        scalar maxDisp = 0;
        forAll(md.pts, p) maxDisp = max(maxDisp, mag(md.pts[p] - mesh.points()[p]));
        Info<< "Max point displacement " << returnReduce(maxDisp, maxOp<scalar>())
            << " m" << endl;

        if (!args.optionFound("dryRun"))
        {
            pointIOField newPoints
            (
                IOobject
                (
                    "points",
                    mesh.pointsInstance(),
                    polyMesh::meshSubDir,
                    mesh,
                    IOobject::NO_READ,
                    IOobject::NO_WRITE,
                    false
                ),
                md.pts
            );
            newPoints.write();
            Info<< "Wrote corrected points to "
                << mesh.pointsInstance()/polyMesh::meshSubDir << endl;
        }
    }

    if (args.optionFound("writeCollapseSet"))
    {
        labelHashSet sel;
        forAll(md.vmask, f)
        {
            if ((md.vmask[f] & 1) && !md.isCoupled(f)) sel.insert(f);
        }
        faceSet collapseSet(mesh, "mdCollapse", sel);
        collapseSet.write();
        Info<< "Faces with inverted pyramids written to faceSet mdCollapse: "
            << returnReduce(label(sel.size()), sumOp<label>()) << endl;
    }

    Info<< "End" << endl;
    return 0;
}


// ************************************************************************* //
