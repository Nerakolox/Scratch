import { describe, expect, it } from 'vitest'
import { EMPTY_PAYLOAD_SHA256, signS3Request } from '@/features/backup/providers/s3-signer'

describe('S3 Signature V4', () => {
  it('matches the published AWS GetObject example signature', async () => {
    const headers = await signS3Request({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      payloadHash: EMPTY_PAYLOAD_SHA256,
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      date: new Date('2013-05-24T00:00:00Z'),
      headers: { Range: 'bytes=0-9' },
    })
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_SHA256)
    expect(headers.Authorization).toContain(
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date',
    )
    expect(headers.Authorization).toContain(
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
    expect(headers.host).toBeUndefined()
  })

  it('includes session tokens and query parameters in the signature', async () => {
    const headers = await signS3Request({
      method: 'GET',
      url: new URL(
        'https://bucket.s3.example.com?list-type=2&prefix=scratch%2Fscratchbackup-&max-keys=1000',
      ),
      payloadHash: EMPTY_PAYLOAD_SHA256,
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      region: 'auto',
      sessionToken: 'token-123',
      date: new Date('2026-11-10T12:00:00Z'),
    })
    expect(headers['x-amz-security-token']).toBe('token-123')
    expect(headers.Authorization).toContain('Credential=AKIDEXAMPLE/20261110/auto/s3/aws4_request')
    expect(headers.Authorization).toMatch(/Signature=[a-f0-9]{64}$/)
  })
})
